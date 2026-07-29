var activeTabPorts = {}
var injectQueue = []

// The service worker is restarted on demand, so this runs on every startup
// and keeps the module registrations in storage up to date.
fetch(chrome.runtime.getURL("settings.json"))
    .then(function (response) { return response.json(); })
    .then(function (settings) {
        if (settings.modules.length){
            var onUpdateArr = [];
            var onCompletedArr = [];

            for (var i = 0, len = settings.modules.length; i < len; i++) {
                var module = settings.modules[i];

                if (!module.path){
                    console.error("module at index["+i+"] is missing path.");
                    break;
                }

                if (!module.runAt || !Object.keys(module.runAt).length){
                    console.error("module at index["+i+"] is missing runAt.");
                    break;
                }

                if (module.runAt.onUpdate){
                    onUpdateArr.push({path: module.path, url: module.runAt.onUpdate});
                }

                if (module.runAt.onCompleted){
                    onCompletedArr.push({path: module.path, url: module.runAt.onCompleted});
                }
            }

            chrome.storage.local.set({onUpdateArr: onUpdateArr, onCompletedArr: onCompletedArr}, function() {
              if(chrome.runtime.lastError) {
                console.error("Error storing module registrations: " + chrome.runtime.lastError.message);
              }
            });

        }else{
            console.error("modules is missing in settings.json");
        }
    })
    .catch(function (e) {
        console.error(e);
    });

chrome.action.onClicked.addListener(function(tab) {
    //chrome.tabs.create({"url": "https://screeps.com/a/#!/map"});
    chrome.runtime.openOptionsPage();
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status == "complete"){
        if (tab.url && tab.url.startsWith("https://screeps.com/a/#!/")){

            chrome.storage.local.get("onUpdateArr", function(data) {
                if (data.onUpdateArr){
                    data.onUpdateArr.forEach(function(info){
                        if (tab.url.startsWith(info.url)){
                            getStorageSync(info.path, function(option){
                                if (option && option.enabled !== false){
                                    executeModule(tabId, info, option.config);
                                }else{
                                    executeModule(tabId, info);
                                }
                            });
                        }
                    });
                }else{
                    console.error("Failed to read array from onUpdateArr in local storage.");
                }
            });
        }
    }
});

chrome.webRequest.onCompleted.addListener(function(details) {
    if (details.tabId < 0){
        return;
    }

    chrome.storage.local.get("onCompletedArr", function(data) {
        if (data.onCompletedArr){
            data.onCompletedArr.forEach(function(info){
                if (details.url.startsWith(info.url)){
                    getStorageSync(info.path, function(option){
                        if (option && option.enabled !== false){
                            executeModule(details.tabId, info, option.config);
                        }else{
                            executeModule(details.tabId, info);
                        }
                    });
                }
            });
        }else{
            console.error("Failed to read array from onCompletedArr in local storage.");
        }
    });
}, {urls: ["*://screeps.com/*"]});

chrome.runtime.onMessage.addListener(function(request, sender, callback) {
    if (request.action == "xhttp") {
        var method = request.method ? request.method.toUpperCase() : 'GET';
        var options = {method: method};

        if (method == 'POST') {
            options.headers = {'Content-Type': 'application/x-www-form-urlencoded'};
            options.body = request.data;
        }

        fetch(request.url, options)
            .then(function(response) { return response.text(); })
            .then(function(responseText) {
                callback(responseText);
            })
            .catch(function(e) {
                console.error("Error in xhttp: " + e);
                callback();
            });

        return true; // prevents the callback from being called too early on return
    } else if (request.action == "injected"){
        injectQueue = injectQueue.filter(item => item !== request.data);
    }
});

function getStorageSync(path, cb){
    var name = path.replace("modules/", "").replace(".js", "");

    chrome.storage.sync.get(name, function(data) {
        if (data && data[name]){
            cb(data[name]);
        }else{
            cb();
        }
    });
}

function executeModule(tabId, info, config, tries = 15){
    if (!activeTabPorts[tabId]){
        activeTabPorts[tabId] = {}
    }

    if (!activeTabPorts[tabId][info.path]){
        activeTabPorts[tabId][info.path] = {}
    }

    if (activeTabPorts[tabId][info.path].port){
        activeTabPorts[tabId][info.path].port.postMessage({event: 'update', module:info.path});
    }else{

        if (injectQueue.length === 0){
            injectQueue.push(info.path);

            chrome.scripting.executeScript({
                target: {tabId: tabId},
                func: function(name, config){
                    var module = {name: name};
                    if (config !== null){
                        module.config = config;
                    }
                    globalThis.module = module;
                },
                args: [info.path, config === undefined ? null : config]
            }, function(){
                chrome.scripting.executeScript({
                    target: {tabId: tabId},
                    files: ["module.js", "content.js", info.path]
                }, function(){
                    if (chrome.runtime.lastError){
                        console.error("Failed to inject " + info.path + ": " + chrome.runtime.lastError.message);
                        injectQueue = injectQueue.filter(item => item !== info.path);
                        return;
                    }

                    var port = chrome.tabs.connect(tabId, {name: info.path});

                    port.onMessage.addListener(function(msg) {
                      console.log('received message from tab ' + tabId + ':');
                      console.log(msg);
                    });

                    port.onDisconnect.addListener(function(event) {
                      console.log("port disconnected");
                      delete activeTabPorts[tabId][info.path];
                    });

                    port.postMessage({event: 'inject', module:info.path});

                    activeTabPorts[tabId][info.path].port = port;
                });
            });
        }else{
            if (tries <= 0){
                console.error("Failed to inject: " + info.path);
            }else{
                setTimeout(function(){
                    executeModule(tabId, info, config, tries - 1);
                }, 500);
            }
        }
    }
}
