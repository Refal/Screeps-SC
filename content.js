// Persists across repeated content script injections in the same page
window.__scInjectedModules = window.__scInjectedModules || {};

function inject(obj){
    if (window.__scInjectedModules[obj.name]){
        console.log("injected twice");

        dispatchEvent(obj.name, {event: 'update'});
    }else{
        window.__scInjectedModules[obj.name] = true;

        // Inline <script> tags are blocked by CSP under MV3, so the code is
        // executed in the page's MAIN world by the background service worker.
        chrome.runtime.sendMessage({
            action: 'injectMain',
            data: `(function(){var module = ${toString(obj)}; module._init();})();`
        });
    }

}

function toString(obj){
    var objStr = '';

    for (var member in obj) {
        objStr += (objStr ? ',\n': '') + member + ':';

        if (obj[member] instanceof Array){
            objStr += JSON.stringify(obj[member]);
        }
        else if (typeof obj[member] === 'string'){
            objStr += '"' + obj[member] + '"';
        }
        else if (typeof obj[member] === 'object'){
            objStr += toString(obj[member]);
        }else{
            objStr += obj[member] + '';
        }
    }   

    return `{\n${objStr}\n}`
}

function eventsSentFromScript(e){
    var data = JSON.parse(e.detail);

    switch(data.event) {
        case 'xhttp':
            chrome.runtime.sendMessage({
                method: 'GET',
                action: 'xhttp',
                url: data.url
            }, function(responseText) {
                data.data = responseText;

                dispatchEvent(data.module, data);
            });
            break;
        case 'dispose':
            module._dispose();
            break;
        default:
            console.log(data);
    }
}

function eventsSentFromBackground(msg){

    switch(msg.event) {
        case 'inject':
            document.addEventListener("_" + msg.module, eventsSentFromScript);
            inject(module);
            chrome.runtime.sendMessage({action:'injected', data:msg.module});
            break;
        case 'update':
            dispatchEvent(msg.module, JSON.stringify(msg));
            break;
        case 'dispose':
            dispatchEvent(msg.module, '{"event":"dispose"}');
            document.removeEventListener("_" + msg.module, eventsSentFromScript);
            break;
        default:
            console.error("Unrecognized message event occured in module.js: " + msg.event);
    }
}

function dispatchEvent(name, data){
    if (typeof data === 'object'){
        data = JSON.stringify(data);
    }

    var evt = new CustomEvent(name, {
        detail: data,
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(evt);
}

// This whole file is re-executed once per module injected into this tab
// (files: ["module.js", "content.js", info.path] runs separately per
// module), but chrome.runtime.onConnect fires for every port on the tab,
// not just the module it happens to be registered for. Registering it
// unconditionally on every re-execution stacks up one listener per module
// ever injected, so a single module's port message ends up handled once per
// stacked listener -- causing duplicate xhttp fetches and "Failed to fetch
// callback event" errors when only one of the duplicate deliveries can find
// its callback. Guard registration so only the first execution in this tab
// ever adds it.
if (!window.__scOnConnectRegistered) {
    window.__scOnConnectRegistered = true;

    chrome.runtime.onConnect.addListener(function(port) {
        port.onMessage.addListener(eventsSentFromBackground);
    });
}