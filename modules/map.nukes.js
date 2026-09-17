module.exports.nukes = [];
module.exports.refreshTimer = null;

// Sets up (once per tab, idempotently) a cache + a single implementation of
// the tick/color/link helpers shared with modules/world.battle.radar.js, so
// the two modules poll the same shard tick and nuke list at most once
// between them and never disagree on countdown/color/link logic. This can't
// be a real shared module: each feature file is serialized independently
// (via Function.prototype.toString()) and re-executed in the page's MAIN
// world, so only a runtime object on the page's own `window` -- not a
// module-to-module import -- can actually be shared. Must run inside a
// module.exports function (never as a bare top-level statement), since only
// module.exports.* function bodies survive that serialization step.
module.exports.initSharedCache = function () {
  window.__scThreatCache = window.__scThreatCache || {
    nukes: null,
    nukesFetchedAt: 0,
    currentTickByShard: {},
  };

  window.__scThreatCache.fetchCurrentTick =
    window.__scThreatCache.fetchCurrentTick ||
    function (shard, cb) {
      var cached = window.__scThreatCache.currentTickByShard[shard];
      if (cached && Date.now() - cached.fetchedAt < 55000) {
        cb(cached.time);
        return;
      }

      module.ajaxGet(
        "https://screeps.com/api/game/time?shard=" + shard,
        function (data, error) {
          if (data && data.ok && typeof data.time === "number") {
            window.__scThreatCache.currentTickByShard[shard] = {
              time: data.time,
              fetchedAt: Date.now(),
            };
            cb(data.time);
          } else {
            console.warn(
              "Threat Radar: failed to fetch current tick for " + shard,
              error,
            );
            cb(cached ? cached.time : undefined);
          }
        },
      );
    };

  window.__scThreatCache.getTicksRemaining =
    window.__scThreatCache.getTicksRemaining ||
    function (nuke) {
      var cached = window.__scThreatCache.currentTickByShard[nuke.shard];
      if (!cached || typeof nuke.landTime !== "number") {
        return undefined;
      }
      return nuke.landTime - cached.time;
    };

  window.__scThreatCache.getNukeColor =
    window.__scThreatCache.getNukeColor ||
    function (ticksRemaining) {
      if (ticksRemaining === undefined) {
        return "#808080"; // Gray - unknown timing
      }

      if (ticksRemaining < 1000) {
        return "#FF0000"; // Red - imminent
      } else if (ticksRemaining < 5000) {
        return "#FF8C00"; // DarkOrange
      } else if (ticksRemaining < 20000) {
        return "#FFD700"; // Gold
      }

      return "#4169E1"; // RoyalBlue - far out
    };

  window.__scThreatCache.getNukeLink =
    window.__scThreatCache.getNukeLink ||
    function (nuke, ticksRemaining) {
      if (ticksRemaining !== undefined && ticksRemaining <= 0) {
        return `https://screeps.com/a/#!/history/${nuke.shard}/${nuke.room}?t=${nuke.landTime}`;
      }

      return `https://screeps.com/a/#!/room/${nuke.shard}/${nuke.room}`;
    };
};

module.exports.init = function () {
  module.exports.initSharedCache();
  module.exports.fetchNukes();

  module.exports.refreshTimer = setInterval(function () {
    if (window.location.href.indexOf("#!/map") === -1) {
      return;
    }
    module.exports.fetchNukes();
  }, 60000);
};

module.exports.fetchNukes = function () {
  var shared = window.__scThreatCache;

  if (shared.nukes && Date.now() - shared.nukesFetchedAt < 10000) {
    module.exports.nukes = shared.nukes;
    $("[id^=nuke-marker-]").remove();
    module.exports.update();
    return;
  }

  module.dispatchEvent(
    {
      event: "xhttp",
      url: "https://www.leagueofautomatednations.com/vk/nukes.json",
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
          module.exports.nukes = parsed;
        } else if (parsed && Array.isArray(parsed.nukes)) {
          module.exports.nukes = parsed.nukes;
        } else if (parsed && Array.isArray(parsed.records)) {
          module.exports.nukes = parsed.records;
        } else {
          module.exports.nukes = [];
          throw new Error(
            "Data is not an array (checked root, .nukes, and .records)",
          );
        }
      } catch (e) {
        console.error("Map Nukes: Error parsing nukes data:", e);
        module.exports.nukes = [];
      }

      shared.nukes = module.exports.nukes;
      shared.nukesFetchedAt = Date.now();

      console.log("Map Nukes: Loaded " + module.exports.nukes.length + " nukes");

      $("[id^=nuke-marker-]").remove();
      module.exports.update();
    },
  );
};

module.exports.fetchCurrentTick = function (shard, cb) {
  window.__scThreatCache.fetchCurrentTick(shard, cb);
};

module.exports.update = function () {
  var shard = module.getCurrentShard() || "shard3";

  // Always resolve the tick for the shard being viewed *right now* -- this
  // may run on its own (background 'update' push on an in-SPA route change)
  // with no relation to whichever shard fetchNukes last fetched a tick for.
  // fetchCurrentTick's own cache makes this a no-op fetch when already fresh.
  module.exports.fetchCurrentTick(shard, function (currentTick) {
    module.getScopeData(
      "page-content",
      "WorldMap",
      ["WorldMap.sectors"],
      function (worldMap) {
        var nukesByRoom = {};
        (module.exports.nukes || []).forEach(function (nuke) {
          if (nuke.shard !== shard) {
            return;
          }
          if (currentTick !== undefined && nuke.landTime <= currentTick) {
            return;
          }
          nukesByRoom[nuke.room] = nuke;
        });

        console.log(
          "Map Nukes: shard=" + shard +
          " zoom=" + worldMap.zoom +
          " incomingRooms=" + Object.keys(nukesByRoom).length +
          " (" + Object.keys(nukesByRoom).join(",") + ")",
        );

        if (worldMap.zoom == 3) {
          module.exports.renderZoom3(nukesByRoom);
        } else if (worldMap.zoom == 2) {
          module.exports.renderZoom2(worldMap, nukesByRoom);
        } else if (worldMap.zoom == 1) {
          module.exports.renderZoom1(worldMap, nukesByRoom);
        } else {
          $("[id^=nuke-marker-]").remove();
        }
      },
    );
  });
};

module.exports.renderZoom3 = function (nukesByRoom) {
  var visibleRoomElements = $("canvas.room-objects.ng-scope");

  for (var eleName in visibleRoomElements) {
    var element = visibleRoomElements[eleName];

    if (element.parentNode) {
      var roomName = element.attributes["app:game-map-room-objects"].value;
      var id = "nuke-marker-" + roomName;

      var nukeNodes = $(element.parentNode).children("[id^=nuke-marker-]");
      var hasRoomNode = false;

      for (var i = 0; i < nukeNodes.length; i++) {
        var nodeId = nukeNodes[i].id;

        if (nodeId == id) {
          hasRoomNode = true;
        } else {
          $("#" + nodeId).remove();
        }
      }

      if (!hasRoomNode && nukesByRoom[roomName]) {
        var markerHtml = module.exports.makeMarkerHtml(id, nukesByRoom[roomName], 50);
        $(element.parentNode).append(markerHtml);
      }
    }
  }
};

module.exports.renderZoom2 = function (worldMap, nukesByRoom) {
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

      if (!nukesByRoom[roomName]) {
        continue;
      }

      var id = "nuke-marker-" + sector.firstRoomName + "-" + roomName;
      wantedIds[id] = true;

      if (!document.getElementById(id)) {
        var left = (x + 1) * 50 - 50;
        var top = (y - 1) * 50;

        var markerHtml = module.exports.makeMarkerHtml(
          id,
          nukesByRoom[roomName],
          50,
          left,
          top,
        );
        canvaElement.after(markerHtml);
      }
    }

    canvaElement
      .siblings(`[id^=nuke-marker-${sector.firstRoomName}-]`)
      .each(function () {
        if (!wantedIds[this.id]) {
          $(this).remove();
        }
      });
  }
};

module.exports.renderZoom1 = function (worldMap, nukesByRoom) {
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

      if (!nukesByRoom[roomName]) {
        continue;
      }

      var id = "nuke-marker-1-" + sector.firstRoomName + "-" + roomName;
      wantedIds[id] = true;

      if (!document.getElementById(id)) {
        var left = (x + 1) * 20 - 20;
        var top = (y - 1) * 20;

        var markerHtml = module.exports.makeMarkerHtml(
          id,
          nukesByRoom[roomName],
          20,
          left,
          top,
        );
        $sectorEle.append(markerHtml);
      }
    }

    $sectorEle.find(`[id^=nuke-marker-1-${firstRoomName}-]`).each(function () {
      if (!wantedIds[this.id]) {
        $(this).remove();
      }
    });
  }
};

module.exports.makeMarkerHtml = function (id, nuke, cellSize, left, top) {
  var ticksRemaining = module.exports.getTicksRemaining(nuke);
  var color = module.exports.getNukeColor(ticksRemaining);
  var url = module.exports.getNukeLink(nuke, ticksRemaining);
  var title =
    ticksRemaining !== undefined
      ? `Nuke Lvl ${nuke.level}\nFrom: ${nuke.launchRoom}\n${ticksRemaining} ticks until impact`
      : `Nuke Lvl ${nuke.level}\nFrom: ${nuke.launchRoom}\nImpact tick: ${nuke.landTime}`;
  var dotSize = Math.max(6, Math.round(cellSize * 0.3));

  // Opposite corner from the battle marker, and a rotated square (diamond)
  // instead of a circle so a room with both threats shows both distinctly.
  var positionCss =
    left !== undefined && top !== undefined
      ? `position: absolute; left: ${left + 2}px; top: ${top + 2}px;`
      : `position: absolute; top: 2px; left: 2px;`;

  return `<a id="${id}" href="${url}" target="_blank" title="${title}"
      style="${positionCss} z-index: 2; width: ${dotSize}px; height: ${dotSize}px;
             background: ${color}; transform: rotate(45deg);
             box-shadow: 0 0 2px rgba(0,0,0,0.8); border: 1px solid rgba(0,0,0,0.5);
             cursor: pointer; pointer-events: auto; display: block;"
      ></a>`;
};

module.exports.getTicksRemaining = function (nuke) {
  return window.__scThreatCache.getTicksRemaining(nuke);
};

module.exports.getNukeColor = function (ticksRemaining) {
  return window.__scThreatCache.getNukeColor(ticksRemaining);
};

module.exports.getNukeLink = function (nuke, ticksRemaining) {
  return window.__scThreatCache.getNukeLink(nuke, ticksRemaining);
};
