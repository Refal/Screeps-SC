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

        module.wait(function(){
            return document.querySelectorAll('mat-row.mat-row').length >= list.length;
        }, 20, function(waitError){
            var rows = document.querySelectorAll('mat-row.mat-row');

            for(var i = 0; i < list.length && i < rows.length; i++){
                var historyObj = list[i];

                if (historyObj.type != "market.buy" && historyObj.type != "market.sell"){
                    continue;
                }

                var descriptionCell = rows[i].querySelector('.cdk-column-description');
                if (!descriptionCell){
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

                if (historyObj.type == "market.buy"){
                    if (targetRoomIsMine){
                        descriptionCell.innerHTML = `${roomLink} bought ${market.amount}${resourceIcon} (${market.price}) from ${targetRoomLink} ${transactionCostHtml} ${infoCircle}`;
                    }else{
                        descriptionCell.innerHTML = `${roomLink} bought ${market.amount}${resourceIcon} (${market.price}) from ${targetRoomLink} ${infoCircle}`;
                    }

                }else{
                    if (targetRoomIsMine){
                        descriptionCell.innerHTML = `${roomLink} sold ${market.amount}${resourceIcon} (${market.price}) to ${targetRoomLink} ${transactionCostHtml} ${infoCircle}`;
                    }else{
                        descriptionCell.innerHTML = `${roomLink} sold ${market.amount}${resourceIcon} (${market.price}) to ${targetRoomLink} ${infoCircle}`;
                    }
                }
            }
        });
    });
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
