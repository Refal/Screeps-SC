module.exports.init = function(){
    module.getUserId(function(userid){
        module.ajaxGet("https://screeps.com/api/user/rooms?id=" + userid, function(data, error){
            if (data && data.shards){
                module.exports.shards = data.shards;
            }else{
                module.exports.shards = {};
                console.error(data || error);
            }

            module.exports.update();
        });
    });
}

module.exports.update = function(data){
    // The market page was rebuilt as a modern Angular (Material table)
    // component: the old '.market-history ng-scope' controller and
    // '.market-history-description' elements are gone, and the rendered
    // <mat-row> description cell only ever contains generic text ("Market
    // fee", "Resources bought via market order") with none of the
    // room/resource/price detail the old scope exposed. That detail is only
    // in the network response, so re-fetch the exact same money-history
    // request the page itself just made (URL captured by background.js from
    // the intercepted request) instead of reading it out of Angular.
    var historyUrl = (data && data.requestUrl) || module.requestUrl;

    if (!historyUrl){
        console.error("[Screeps-SC] market.history: no money-history request URL available to replay.");
        return;
    }

    // Mark this as our own replay so background.js's onCompleted listener
    // doesn't treat it as a fresh money-history request and re-trigger
    // update() on it, which would fetch again forever.
    var replayUrl = historyUrl + (historyUrl.indexOf('?') === -1 ? '?' : '&') + '_scNoTrigger=1';

    module.ajaxGet(replayUrl, function(response, error){
        var list = response && response.list;

        if (!list){
            console.error("[Screeps-SC] market.history: unexpected money-history response shape.", response || error);
            return;
        }

        // Rows are matched to history entries by shard/tick/change rather
        // than by position: the rendered table and the replayed response
        // don't reliably line up index-for-index. Entries from every
        // response are kept, since the table can re-render a previously
        // loaded page without making a new request.
        list.forEach(function(historyObj){
            var key = module.exports.entryKey(historyObj.shard || "shard0", historyObj.tick, historyObj.change);
            if (key){
                module.exports.entriesByKey[key] = historyObj;
            }
        });

        module.exports.observeTable();
        module.exports.annotateRows();
    });
}

module.exports.entriesByKey = {};

// Angular reuses <mat-row>s and rewrites their cells whenever the table's data
// changes (paging, re-sorting, revisiting a cached page), which doesn't always
// come with a money-history request. Re-run the (idempotent) pass on any DOM
// change so annotations always follow the row's current data.
module.exports.observeTable = function(){
    if (module.exports.observer){
        return;
    }
    var scheduled = false;
    module.exports.observer = new MutationObserver(function(){
        if (scheduled){
            return;
        }
        scheduled = true;
        setTimeout(function(){
            scheduled = false;
            module.exports.annotateRows();
        }, 50);
    });
    module.exports.observer.observe(document.body, {childList: true, subtree: true, characterData: true});
}

module.exports.annotateRows = function(){
    var rows = document.querySelectorAll('mat-row.mat-row');

    for(var i = 0; i < rows.length; i++){
        var descriptionCell = rows[i].querySelector('.cdk-column-description');
        if (!descriptionCell){
            continue;
        }

        var key = module.exports.rowKey(rows[i]);
        var historyObj = key && module.exports.entriesByKey[key];
        var annotate = historyObj && (historyObj.type == "market.buy" || historyObj.type == "market.sell");

        if (descriptionCell.dataset.scKey){
            if (annotate && descriptionCell.dataset.scKey === key){
                continue; // already annotated for this entry
            }
            module.exports.restoreCell(descriptionCell);
        }

        if (!annotate){
            continue;
        }

        var shard = historyObj.shard || "shard0";
        var market = historyObj.market;
        var type = market.resourceType;
        var roomName = market.roomName;
        var targetRoomName = market.targetRoomName;
        var transactionCost = module.exports.calcTransactionCost(market.amount, roomName, targetRoomName);
        var targetRoomIsMine = false;

        var resourceIcon = `<a href="#!/market/all/${shard}/${type}">
                                <img src="https://s3.amazonaws.com/static.screeps.com/upload/mineral-icons/${type}.png" style="margin-right:0">
                            </a>`;

        var resourceEnergy = `<a href="#!/market/all/${shard}/energy">
                                <img src="https://s3.amazonaws.com/static.screeps.com/upload/mineral-icons/energy.png">
                              </a>`;

        if (module.exports.shards[shard] && module.exports.shards[shard].includes(targetRoomName)){
            let temp = roomName;
            roomName = targetRoomName;
            targetRoomName = temp;
            targetRoomIsMine = true;
        }

        var roomLink = `<a href="#!/room/${shard}/${roomName}">${roomName}</a>`;
        var targetRoomLink = `<a href="#!/room/${shard}/${targetRoomName}">${targetRoomName}</a>`;
        var infoCircle = '<div class="fa fa-question-circle" title=\'' + JSON.stringify(market) + '\'></div>'
        var transactionCostHtml = `(<span style="color:#ff8f8f;margin-right:-12px">-${transactionCost} ${resourceEnergy}</span>)`
        var html;

        if (historyObj.type == "market.buy"){
            if (targetRoomIsMine){
                html = `${roomLink} bought ${market.amount}${resourceIcon} (${market.price}) from ${targetRoomLink} ${transactionCostHtml} ${infoCircle}`;
            }else{
                html = `${roomLink} bought ${market.amount}${resourceIcon} (${market.price}) from ${targetRoomLink} ${infoCircle}`;
            }

        }else{
            if (targetRoomIsMine){
                html = `${roomLink} sold ${market.amount}${resourceIcon} (${market.price}) to ${targetRoomLink} ${transactionCostHtml} ${infoCircle}`;
            }else{
                html = `${roomLink} sold ${market.amount}${resourceIcon} (${market.price}) to ${targetRoomLink} ${infoCircle}`;
            }
        }

        module.exports.annotateCell(descriptionCell, key, html);
    }
}

module.exports.entryKey = function(shard, tick, change){
    var changeNum = typeof change === "number" ? change : parseFloat(change);
    if (tick === undefined || tick === null || tick === "" || isNaN(changeNum)){
        return null;
    }
    return `${shard}|${tick}|${Math.round(changeNum * 1000)}`;
}

// Reads a cell of a row by its cdk column class, falling back to the
// position of the matching header cell.
module.exports.rowCellText = function(row, column, headerText){
    var cell = row.querySelector('.cdk-column-' + column);
    if (!cell){
        var headers = Array.from(document.querySelectorAll('mat-header-cell, .mat-header-cell'));
        var index = headers.findIndex(function(h){ return h.textContent.trim().toLowerCase() === headerText.toLowerCase(); });
        if (index !== -1){
            cell = row.querySelectorAll('mat-cell, .mat-cell')[index];
        }
    }
    if (!cell){
        return null;
    }
    // Ignore our own injected markup, if any.
    var orig = cell.querySelector('.sc-orig');
    return (orig || cell).textContent.trim();
}

module.exports.rowKey = function(row){
    var shard = module.exports.rowCellText(row, 'shard', 'Shard') || "shard0";
    var tick = module.exports.rowCellText(row, 'tick', 'Tick');
    var change = module.exports.rowCellText(row, 'change', 'Change');
    if (!tick || !change){
        return null;
    }
    return module.exports.entryKey(shard, tick.replace(/[^\d]/g, ''), change.replace(/\u2212/g, '-').replace(/[^\d.\-]/g, ''));
}

// Hide Angular's original nodes instead of replacing them via innerHTML:
// Angular keeps updating those nodes by reference when it reuses the row for
// different data, so they must stay in the DOM to be restorable.
module.exports.annotateCell = function(cell, key, html){
    var orig = document.createElement('span');
    orig.className = 'sc-orig';
    orig.style.display = 'none';
    while (cell.firstChild){
        orig.appendChild(cell.firstChild);
    }
    var desc = document.createElement('span');
    desc.className = 'sc-desc';
    desc.innerHTML = html;
    cell.appendChild(orig);
    cell.appendChild(desc);
    cell.dataset.scKey = key;
}

module.exports.restoreCell = function(cell){
    var desc = cell.querySelector('.sc-desc');
    if (desc){
        desc.remove();
    }
    var orig = cell.querySelector('.sc-orig');
    if (orig){
        while (orig.firstChild){
            cell.insertBefore(orig.firstChild, orig);
        }
        orig.remove();
    }
    delete cell.dataset.scKey;
}

/* taken from @screeps market */
module.exports.calcTransactionCost = function (amount, roomName1, roomName2) {

    var distance = module.exports.calcRoomsDistance(roomName1, roomName2);

    return Math.ceil(amount*(1-Math.exp(-distance/30)))
}

/* taken from @screeps utils */
module.exports.calcRoomsDistance = function (room1, room2) {
    var _exports$roomNameToXY = module.exports.roomNameToXY(room1);

    var _exports$roomNameToXY2 = module.exports._slicedToArray(_exports$roomNameToXY, 2);

    var x1 = _exports$roomNameToXY2[0];
    var y1 = _exports$roomNameToXY2[1];

    var _exports$roomNameToXY3 = module.exports.roomNameToXY(room2);

    var _exports$roomNameToXY4 = module.exports._slicedToArray(_exports$roomNameToXY3, 2);

    var x2 = _exports$roomNameToXY4[0];
    var y2 = _exports$roomNameToXY4[1];

    // Shards don't wrap around (unlike the single finite world this was
    // originally written for), so no toroidal correction is needed here.
    var dx = Math.abs(x2 - x1);
    var dy = Math.abs(y2 - y1);
    return Math.max(dx, dy);
}

/* taken from @screeps utils */
module.exports.roomNameToXY = function (name) {

    name = name.toUpperCase();

    var match = name.match(/^(\w)(\d+)(\w)(\d+)$/);
    if (!match) {
        return [undefined, undefined];
    }

    var _match = module.exports._slicedToArray(match, 5);

    var hor = _match[1];
    var x = _match[2];
    var ver = _match[3];
    var y = _match[4];

    if (hor == 'W') {
        x = -x - 1;
    } else {
        x = +x;
    }
    if (ver == 'N') {
        y = -y - 1;
    } else {
        y = +y;
    }
    return [x, y];
};

/* taken from @screeps utils */
module.exports._slicedToArray = (function() {
    function sliceIterator(arr, i) {
        var _arr = [];
        var _n = true;
        var _d = false;
        var _e = undefined;
        try {
            for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
                _arr.push(_s.value);
                if (i && _arr.length === i) break;
            }
        } catch (err) {
            _d = true;
            _e = err;
        } finally {
            try {
                if (!_n && _i["return"]) _i["return"]();
            } finally {
                if (_d) throw _e;
            }
        }
        return _arr;
    }
    return function(arr, i) {
        if (Array.isArray(arr)) {
            return arr;
        } else if (Symbol.iterator in Object(arr)) {
            return sliceIterator(arr, i);
        } else {
            throw new TypeError("Invalid attempt to destructure non-iterable instance");
        }
    };
})();
