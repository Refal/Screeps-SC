var activeTabPorts = {}
// Keyed by tabId: paths currently mid-injection for that tab. Scoped per-tab
// because the hazard this guards against (two injections racing to set the
// shared globalThis.module value before content.js reads it) only exists
// within a single tab, not across tabs or unrelated modules.
var injectQueue = {}

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
                if (details.url.startsWith(info.url) && details.url.indexOf('_scNoTrigger=') === -1){
                    getStorageSync(info.path, function(option){
                        if (option && option.enabled !== false){
                            executeModule(details.tabId, info, option.config, undefined, details.url);
                        }else{
                            executeModule(details.tabId, info, undefined, undefined, details.url);
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
        if (sender.tab && injectQueue[sender.tab.id]){
            injectQueue[sender.tab.id] = injectQueue[sender.tab.id].filter(item => item !== request.data);

            if (injectQueue[sender.tab.id].length === 0){
                delete injectQueue[sender.tab.id];
            }
        }
    } else if (request.action == "injectMain"){
        if (!sender.tab || sender.tab.id < 0){
            return;
        }

        // Page CSP blocks inline <script> tags, so modules are executed in the
        // page's MAIN world through the userScripts API instead.
        try {
            chrome.userScripts.execute({
                target: {tabId: sender.tab.id},
                world: "MAIN",
                js: [{code: request.data}]
            }).then(function(results){
                (results || []).forEach(function(result){
                    if (result && result.error){
                        console.error("Module execution error: " + result.error);
                        logToTab(sender.tab.id, "module execution error: " + result.error);
                    }
                });
            }).catch(function(e){
                console.error("userScripts.execute failed: " + e);
                logToTab(sender.tab.id, "module execution failed: " + e);
            });
        } catch (e) {
            console.error("chrome.userScripts is unavailable. Enable the 'Allow user scripts' " +
                "toggle for this extension in chrome://extensions (Chrome 138+), or enable " +
                "Developer mode (older Chrome). Requires Chrome 135+. " + e);
            logToTab(sender.tab.id, "chrome.userScripts is unavailable, cannot run modules. " +
                "Enable the 'Allow user scripts' toggle for this extension in chrome://extensions.");
        }
    }
});

// Errors and diagnostics from the background worker are invisible unless the
// service worker console is open, so mirror them into the tab's console.
function logToTab(tabId, message){
    chrome.scripting.executeScript({
        target: {tabId: tabId},
        func: function(msg){ console.log("[Screeps-SC] " + msg); },
        args: [message]
    }).catch(function(){});
}

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

function executeModule(tabId, info, config, tries = 15, requestUrl){
    if (!activeTabPorts[tabId]){
        activeTabPorts[tabId] = {}
    }

    if (!activeTabPorts[tabId][info.path]){
        activeTabPorts[tabId][info.path] = {}
    }

    if (activeTabPorts[tabId][info.path].port){
        activeTabPorts[tabId][info.path].port.postMessage({event: 'update', module:info.path, requestUrl: requestUrl});
    }else{

        var queue = injectQueue[tabId] || (injectQueue[tabId] = []);

        if (queue.length === 0){
            queue.push(info.path);
            logToTab(tabId, "injecting " + info.path);

            chrome.scripting.executeScript({
                target: {tabId: tabId},
                func: function(name, config, requestUrl){
                    var module = {name: name};
                    if (config !== null){
                        module.config = config;
                    }
                    if (requestUrl !== null){
                        module.requestUrl = requestUrl;
                    }
                    globalThis.module = module;
                },
                args: [info.path, config === undefined ? null : config, requestUrl === undefined ? null : requestUrl]
            }, function(){
                chrome.scripting.executeScript({
                    target: {tabId: tabId},
                    files: ["module.js", "content.js", info.path]
                }, function(){
                    if (chrome.runtime.lastError){
                        console.error("Failed to inject " + info.path + ": " + chrome.runtime.lastError.message);
                        logToTab(tabId, "failed to inject " + info.path + ": " + chrome.runtime.lastError.message);
                        queue = injectQueue[tabId] = queue.filter(item => item !== info.path);
                        if (queue.length === 0){
                            delete injectQueue[tabId];
                        }
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
                logToTab(tabId, "gave up injecting " + info.path + " (another module never finished injecting)");
            }else{
                setTimeout(function(){
                    executeModule(tabId, info, config, tries - 1, requestUrl);
                }, 500);
            }
        }
    }
}
