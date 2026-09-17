module.exports.battles = [];
module.exports.refreshTimer = null;

module.exports.init = function () {
  module.exports.fetchBattles();

  module.exports.refreshTimer = setInterval(function () {
    if (window.location.href.indexOf("#!/map") === -1) {
      return;
    }
    module.exports.fetchBattles();
  }, 60000);
};

module.exports.fetchBattles = function () {
  module.dispatchEvent(
    {
      event: "xhttp",
      url: "https://www.leagueofautomatednations.com/vk/battles_full.json",
    },
    function (response) {
      try {
        if (!response.data) {
          throw new Error("Empty response data");
        }

        var parsed =
          typeof response.data === "string"
            ? JSON.parse(response.data)
            : response.data;

        if (Array.isArray(parsed)) {
          module.exports.battles = parsed;
        } else if (parsed && Array.isArray(parsed.battles)) {
          module.exports.battles = parsed.battles;
        } else if (parsed && Array.isArray(parsed.records)) {
          module.exports.battles = parsed.records;
        } else {
          module.exports.battles = [];
          throw new Error(
            "Data is not an array (checked root, .battles, and .records)",
          );
        }
      } catch (e) {
        console.error("Map Battles: Error parsing battles data:", e);
        module.exports.battles = [];
      }

      console.log("Map Battles: Loaded " + module.exports.battles.length + " battles");

      $("[id^=battle-marker-]").remove();
      module.exports.update();
    },
  );
};

module.exports.update = function () {
  module.getScopeData(
    "page-content",
    "WorldMap",
    ["WorldMap.sectors"],
    function (worldMap) {
      var shard = module.getCurrentShard() || "shard3";
      var minSetting = (module.config && module.config.minClassification) || "2";

      if (minSetting === "Off") {
        $("[id^=battle-marker-]").remove();
        return;
      }

      var minLevel = parseInt(minSetting, 10) || 0;

      var battlesByRoom = {};
      (module.exports.battles || []).forEach(function (battle) {
        if (battle.shard !== shard) {
          return;
        }
        if ((parseInt(battle.classification, 10) || 0) < minLevel) {
          return;
        }
        battlesByRoom[battle.room] = battle;
      });

      console.log(
        "Map Battles: shard=" + shard +
        " zoom=" + worldMap.zoom +
        " qualifyingRooms=" + Object.keys(battlesByRoom).length +
        " (" + Object.keys(battlesByRoom).join(",") + ")",
      );

      if (worldMap.zoom == 3) {
        module.exports.renderZoom3(battlesByRoom);
      } else if (worldMap.zoom == 2) {
        module.exports.renderZoom2(worldMap, battlesByRoom);
      } else if (worldMap.zoom == 1) {
        module.exports.renderZoom1(worldMap, battlesByRoom);
      } else {
        $("[id^=battle-marker-]").remove();
      }
    },
  );
};

module.exports.renderZoom3 = function (battlesByRoom) {
  var visibleRoomElements = $("canvas.room-objects.ng-scope");

  for (var eleName in visibleRoomElements) {
    var element = visibleRoomElements[eleName];

    if (element.parentNode) {
      var roomName = element.attributes["app:game-map-room-objects"].value;
      var id = "battle-marker-" + roomName;

      var battleNodes = $(element.parentNode).children("[id^=battle-marker-]");
      var hasRoomNode = false;

      for (var i = 0; i < battleNodes.length; i++) {
        var nodeId = battleNodes[i].id;

        if (nodeId == id) {
          hasRoomNode = true;
        } else {
          $("#" + nodeId).remove();
        }
      }

      if (!hasRoomNode && battlesByRoom[roomName]) {
        var markerHtml = module.exports.makeMarkerHtml(id, battlesByRoom[roomName], 50);
        $(element.parentNode).append(markerHtml);
      }
    }
  }
};

module.exports.renderZoom2 = function (worldMap, battlesByRoom) {
  var sectors = worldMap.sectors;

  for (var sectorId in sectors) {
    var sector = sectors[sectorId];

    if (!sector.rooms) {
      continue;
    }

    var canvaElement = $(`#${sector.id}`);

    if (canvaElement.length === 0) {
      continue;
    }

    var x = 0;
    var y = 0;
    var rooms = sector.rooms.split(",");
    var wantedIds = {};

    for (var i = 0; i < rooms.length; i++) {
      var roomName = rooms[i];

      if (i % 4 == 0 && i != 0) {
        y = 1;
        x += 1;
      } else {
        y += 1;
      }

      if (!battlesByRoom[roomName]) {
        continue;
      }

      var id = "battle-marker-" + sector.firstRoomName + "-" + roomName;
      wantedIds[id] = true;

      if (!document.getElementById(id)) {
        var left = (x + 1) * 50 - 50;
        var top = (y - 1) * 50;

        var markerHtml = module.exports.makeMarkerHtml(
          id,
          battlesByRoom[roomName],
          50,
          left,
          top,
        );
        canvaElement.after(markerHtml);
      }
    }

    canvaElement
      .siblings(`[id^=battle-marker-${sector.firstRoomName}-]`)
      .each(function () {
        if (!wantedIds[this.id]) {
          $(this).remove();
        }
      });
  }
};

module.exports.renderZoom1 = function (worldMap, battlesByRoom) {
  var sectorMapping = {};

  for (var sectorName in worldMap.sectors) {
    var sector = worldMap.sectors[sectorName];
    sectorMapping[sector.firstRoomName] = sector;
  }

  var sectorElements = $(".map-sector.map-sector--zoom1.ng-scope");

  for (var sectorId in sectorElements) {
    var sectorEle = sectorElements[sectorId];

    if (!sectorEle.style || !sectorEle.style.backgroundImage) {
      continue;
    }

    var match = sectorEle.style.backgroundImage.match(/zoom1\/(.*)\.png/);

    if (!match) {
      continue;
    }

    var firstRoomName = match.pop();
    var $sectorEle = $(sectorEle);
    var sector = sectorMapping[firstRoomName];

    if (!sector || !sector.rooms) {
      continue;
    }

    var x = 0;
    var y = 0;
    var rooms = sector.rooms.split(",");
    var wantedIds = {};

    for (var i = 0; i < rooms.length; i++) {
      var roomName = rooms[i];

      if (i % 10 == 0 && i != 0) {
        y = 1;
        x += 1;
      } else {
        y += 1;
      }

      if (!battlesByRoom[roomName]) {
        continue;
      }

      var id = "battle-marker-1-" + sector.firstRoomName + "-" + roomName;
      wantedIds[id] = true;

      if (!document.getElementById(id)) {
        var left = (x + 1) * 20 - 20;
        var top = (y - 1) * 20;

        var markerHtml = module.exports.makeMarkerHtml(
          id,
          battlesByRoom[roomName],
          20,
          left,
          top,
        );
        $sectorEle.append(markerHtml);
      }
    }

    $sectorEle.find(`[id^=battle-marker-1-${firstRoomName}-]`).each(function () {
      if (!wantedIds[this.id]) {
        $(this).remove();
      }
    });
  }
};

module.exports.makeMarkerHtml = function (id, battle, cellSize, left, top) {
  var color = module.exports.getBattleColor(battle.classification);
  var lastSeen = new Date(battle.lastseen).toLocaleString();
  var participants = module.exports.getBattleParticipants(battle);
  var title = `Battle Lvl ${battle.classification}\n${participants.attackers} -> ${participants.defenders}\nLast seen: ${lastSeen}\nID: ${battle.battleid}`;
  var url =
    battle.lastpvptick !== undefined
      ? `https://screeps.com/a/#!/history/${battle.shard}/${battle.room}?t=${battle.lastpvptick}`
      : `https://screeps.com/a/#!/room/${battle.shard}/${battle.room}`;
  var dotSize = Math.max(6, Math.round(cellSize * 0.35));

  var positionCss =
    left !== undefined && top !== undefined
      ? `position: absolute; left: ${left + cellSize - dotSize - 2}px; top: ${top + 2}px;`
      : `position: absolute; top: 2px; right: 2px;`;

  return `<a id="${id}" href="${url}" target="_blank" title="${title}"
      style="${positionCss} z-index: 2; width: ${dotSize}px; height: ${dotSize}px;
             border-radius: 50%; background: ${color};
             box-shadow: 0 0 2px rgba(0,0,0,0.8); border: 1px solid rgba(0,0,0,0.5);
             cursor: pointer; pointer-events: auto; display: block;"
      ></a>`;
};

// Battle records may have zero, one, or multiple participants per role
// (e.g. multi-player fights), so this groups by role rather than assuming
// a single attacker/defender pair.
module.exports.getBattleParticipants = function (battle) {
  var attackers = [];
  var defenders = [];

  (battle.participants || []).forEach(function (participant) {
    if (participant.role === "attacker") {
      attackers.push(participant.user);
    } else if (participant.role === "defender") {
      defenders.push(participant.user);
    }
  });

  return {
    attackers: attackers.length ? attackers.join(", ") : "Unknown",
    defenders: defenders.length ? defenders.join(", ") : "Unknown",
  };
};

module.exports.getBattleColor = function (classification) {
  var level = parseInt(classification, 10) || 0;

  switch (level) {
    case 0:
      return "#A9A9A9";
    case 1:
      return "#00CED1";
    case 2:
      return "#FFD700";
    case 3:
      return "#FF8C00";
    case 4:
      return "#FF4500";
    case 5:
      return "#DC143C";
    case 6:
      return "#FF00FF";
    case 7:
      return "#8B008B";
    default:
      if (level > 7) return "#FF0000";
      return "#FFFFFF";
  }
};
