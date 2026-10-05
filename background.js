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
            .then(function(response) {
                if (!response.ok){
                    throw new Error("HTTP " + response.status);
                }
                return response.text();
            })
            .then(function(responseText) {
                callback(responseText);
            })
            .catch(function(e) {
                console.error("Error in xhttp (" + request.url + "): " + e);
                callback();
            });

        return true; // prevents the callback from being called too early on return
    } else if (request.action == "injected"){
        if (sender.tab){
            releaseInjectLock(sender.tab.id, request.data);
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

// Per-tab state is otherwise never cleaned up, and pending retries would keep
// targeting a tab that no longer exists ("No tab with id").
chrome.tabs.onRemoved.addListener(function(tabId){
    delete activeTabPorts[tabId];
    delete injectQueue[tabId];
});

chrome.tabs.onReplaced.addListener(function(addedTabId, removedTabId){
    delete activeTabPorts[removedTabId];
    delete injectQueue[removedTabId];
});

// The injection lock is normally released by the content script's "injected"
// ack. If that ack never arrives (page navigated away, content script threw,
// no onConnect listener) the lock would leak and every later module on the
// tab would fail with "Failed to inject", so it is also released on port
// disconnect and after a timeout.
function releaseInjectLock(tabId, path){
    if (!injectQueue[tabId]){
        return;
    }

    injectQueue[tabId] = injectQueue[tabId].filter(item => item !== path);

    if (injectQueue[tabId].length === 0){
        delete injectQueue[tabId];
    }
}

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
    // Port state is only created once an injection succeeds, so a retry
    // firing after the tab closed doesn't re-create entries for it.
    var entry = activeTabPorts[tabId] && activeTabPorts[tabId][info.path];

    if (entry && entry.port){
        entry.port.postMessage({event: 'update', module:info.path, requestUrl: requestUrl});
    }else{

        var queue = injectQueue[tabId] || (injectQueue[tabId] = []);

        if (queue.length === 0){
            queue.push(info.path);
            logToTab(tabId, "injecting " + info.path);

            // Some executeScript lastErrors are a transient race (the frame is
            // momentarily between navigations) and are retried. Others won't
            // resolve by waiting: the tab is gone, or the main frame shows
            // Chrome's network error page, which stays until the tab reloads.
            // The next onUpdated "complete" after a reload retries those.
            var retryOrGiveUp = function(reason){
                releaseInjectLock(tabId, info.path);

                if (/No tab with id/.test(reason)){
                    delete activeTabPorts[tabId];
                }

                if (/No tab with id|showing error page/.test(reason)){
                    console.warn("Skipping " + info.path + ": " + reason);
                    return;
                }

                if (tries > 0){
                    setTimeout(function(){
                        executeModule(tabId, info, config, tries - 1, requestUrl);
                    }, 500);
                }else{
                    console.error("Failed to inject " + info.path + ": " + reason);
                    logToTab(tabId, "failed to inject " + info.path + ": " + reason);
                }
            };

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
                if (chrome.runtime.lastError){
                    retryOrGiveUp(chrome.runtime.lastError.message);
                    return;
                }

                chrome.scripting.executeScript({
                    target: {tabId: tabId},
                    files: ["module.js", "content.js", info.path]
                }, function(){
                    if (chrome.runtime.lastError){
                        retryOrGiveUp(chrome.runtime.lastError.message);
                        return;
                    }

                    var port = chrome.tabs.connect(tabId, {name: info.path});
                    var lockTimer = setTimeout(function(){
                        releaseInjectLock(tabId, info.path);
                    }, 3000);

                    port.onMessage.addListener(function(msg) {
                      console.log('received message from tab ' + tabId + ':');
                      console.log(msg);
                    });

                    port.onDisconnect.addListener(function(event) {
                      console.log("port disconnected");
                      clearTimeout(lockTimer);
                      releaseInjectLock(tabId, info.path);
                      if (activeTabPorts[tabId]){
                          delete activeTabPorts[tabId][info.path];
                      }
                    });

                    port.postMessage({event: 'inject', module:info.path});

                    if (!activeTabPorts[tabId]){
                        activeTabPorts[tabId] = {};
                    }
                    activeTabPorts[tabId][info.path] = {port: port};
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
