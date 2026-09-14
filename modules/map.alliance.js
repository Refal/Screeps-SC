module.exports.colors = [];

module.exports.init = function () {
  var url;

  var shard = module.getCurrentShard();
  if (!shard) {
    shard = "shard3";
  }

  url = `https://www.leagueofautomatednations.com/map/${shard}/alliances.js`;

  module.dispatchEvent({ event: "xhttp", url: url }, function (response) {
    try {
      module.exports.alliances = JSON.parse(response.data);
    } catch (e) {
      console.error("Error parsing alliances data:", e);
      return;
    }

    module.exports.userToAlliance = {};
    var usedColors = {};

    for (var alliance in module.exports.alliances) {
      var members = module.exports.alliances[alliance].members;
      for (var member in members) {
        var memberName = members[member];

        module.exports.userToAlliance[memberName] = alliance;
      }

      // Generate unique color based on alliance name
      var hash = 0;
      for (var i = 0; i < alliance.length; i++) {
        hash = alliance.charCodeAt(i) + ((hash << 5) - hash);
      }

      var offset = 0;
      var color;
      while (true) {
        var finalHash = hash + offset;
        var c = (finalHash & 0x00ffffff).toString(16).toUpperCase();
        color = "#" + "00000".substring(0, 6 - c.length) + c;

        if (!usedColors[color]) {
          usedColors[color] = true;
          break;
        }
        offset += 54321; // Shift hash to find next available color
      }

      module.exports.alliances[alliance].color = color;
    }

    console.log("Alliances loaded:", Object.keys(module.exports.alliances));
    console.log("User to Alliance mapping:", module.exports.userToAlliance);

    module.exports.update();
  });
};

module.exports.update = function () {
  module.getScopeData(
    "page-content",
    "WorldMap",
    [
      "WorldMap.displayOptions.layer",
      "WorldMap.roomUsers",
      "WorldMap.sectors",
      "WorldMap.roomStats",
    ],
    function (worldMap) {
      // DOMSubtreeModified was removed from Chrome; watch the room name
      // element with a MutationObserver instead.
      var roomNameElement = document.getElementsByClassName(
        "room-name ng-binding",
      )[0];

      if (roomNameElement) {
        if (module.exports.roomNameObserver) {
          module.exports.roomNameObserver.disconnect();
        }

        module.exports.roomNameObserver = new MutationObserver(function () {
          var roomElement = document.getElementsByClassName(
            "room-name ng-binding",
          )[0];
          if (!roomElement) {
            return;
          }
          var roomName = roomElement.innerText.replace("Room", "").trim();
          $("div[id^=display-]").remove();

          if (
            worldMap.roomStats[roomName] &&
            worldMap.roomStats[roomName].own
          ) {
            var username =
              worldMap.roomUsers[worldMap.roomStats[roomName].own.user]
                .username;
            var allianceName = module.exports.userToAlliance[username];

            if (allianceName) {
              var div = document.createElement("div");
              div.id = "display-" + roomName;

              var label = document.createElement("label");
              label.innerText = "Alliance: ";

              var span = document.createElement("span");
              span.innerText = allianceName;
              span.setAttribute("style", "color:#bbb");

              div.appendChild(label);
              label.appendChild(span);

              roomElement.parentNode.appendChild(div);
            }
          }
        });

        module.exports.roomNameObserver.observe(roomNameElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }

      if (worldMap.displayOptions.layer == "owner0" && worldMap.zoom == 3) {
        var visibleRoomElements = $("canvas.room-objects.ng-scope");

        for (var eleName in visibleRoomElements) {
          var element = visibleRoomElements[eleName];

          if (element.parentNode) {
            var roomName =
              element.attributes["app:game-map-room-objects"].value;

            var id = "alliance-" + roomName;

            var allianceNodes = $(element.parentNode).children(
              "[id^=alliance-]",
            );
            var hasRoomNode = false;

            if (allianceNodes.length > 0) {
              for (var i = 0; i < allianceNodes.length; i++) {
                var roomId = allianceNodes[i].id;

                if (roomId == id) {
                  hasRoomNode = true;
                } else {
                  // need to remove because the map reuse old elements
                  $("#" + roomId).remove();
                }
              }
            }

            if (hasRoomNode == false) {
              if (
                worldMap.roomStats[roomName] &&
                worldMap.roomStats[roomName].own
              ) {
                var username =
                  worldMap.roomUsers[worldMap.roomStats[roomName].own.user]
                    .username;
                var allianceName = module.exports.userToAlliance[username];

                if (
                  module.exports.userToAlliance[username] &&
                  module.exports.alliances[allianceName]
                ) {
                  var div = document.createElement("div");
                  div.id = "alliance-" + roomName;
                  var label = document.createElement("label");
                  var span = document.createElement("span");
                  span.style.color =
                    module.exports.alliances[allianceName].color;
                  span.innerText = allianceName;

                  div.appendChild(label);
                  label.appendChild(span);

                  element.parentNode.appendChild(div);
                }
              }
            }
          }
        }
      } else if (worldMap.zoom == 2) {
        var sectors = worldMap.sectors;

        for (var sectorId in worldMap.sectors) {
          var sector = worldMap.sectors[sectorId];

          if (!sector.rooms) {
            continue;
          }

          var canvaElement = $(`#${sector.id}`);

          if (!canvaElement) {
            continue;
          }

          canvaElement
            .siblings(`div[id^=alliance-]:not([id^=alliance-${sector.firstRoomName}])`)
            .remove();

          var correctRooms = canvaElement.siblings(
            `div[id^=alliance-${sector.firstRoomName}]`,
          );

          if (correctRooms.length == 0) {
            var x = 0;
            var y = 0;
            var rooms = sector.rooms.split(",");

            for (var i = 0; i < rooms.length; i++) {
              var roomName = rooms[i];

              if (i % 4 == 0 && i != 0) {
                y = 1;
                x += 1;
              } else {
                y += 1;
              }

              if (
                !worldMap.roomStats[roomName] ||
                !worldMap.roomStats[roomName].own
              ) {
                continue;
              }

              var username =
                worldMap.roomUsers[worldMap.roomStats[roomName].own.user]
                  .username;
              var allianceName = module.exports.userToAlliance[username];

              if (
                module.exports.userToAlliance[username] &&
                module.exports.alliances[allianceName]
              ) {
                var id = "alliance-" + sector.firstRoomName + "-" + roomName;

                if (!document.getElementById(id)) {
                  var left = (x + 1) * 50 - 50;
                  var top = (y - 1) * 50;
                  var newEle = document.createElement("div");
                  var css = `z-index: 1;
                                height: 50px;
                                width: 50px;
                                position: absolute;
                                left: ${left}px;
                                top: ${top}px;`;

                  if (module.config && module.config.background === "Image") {
                    var url =
                      "http://www.leagueofautomatednations.com/obj/" +
                      module.exports.alliances[allianceName].logo;

                    css += `background-image: url("${url}");
                                    background-size: 50px 50px;
                                    opacity : 0.2;`;
                  } else {
                    var c = module.exports.hexToRgb(
                      module.exports.alliances[allianceName].color,
                    );
                    c.a = 0.3;

                    css += `background: rgba(${c.r},${c.g},${c.b},${c.a});`;
                  }

                  newEle.id = id;
                  newEle.className = "room-prohibited";
                  newEle.setAttribute("style", css);
                  canvaElement.after(newEle);
                }
              }
            }
          }
        }
      } else if (worldMap.zoom == 1) {
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

          var firstRoomName = sectorEle.style.backgroundImage
            .match(/zoom1\/(.*)\.png/)
            .pop();

          var $sectorEle = $(sectorEle);
          var sector = sectorMapping[firstRoomName];
          if (sector) {
            $sectorEle
              .find(`div[id^=alliance-]:not([id^=alliance-1-${firstRoomName}])`)
              .remove();

            var correctRooms = $sectorEle.find(
              `div[id^=alliance-1-${firstRoomName}]`,
            );

            if (correctRooms.length == 0 && sector.rooms) {
              var x = 0;
              var y = 0;
              var rooms = sector.rooms.split(",");

              for (var i = 0; i < rooms.length; i++) {
                var roomName = rooms[i];

                if (i % 10 == 0 && i != 0) {
                  y = 1;
                  x += 1;
                } else {
                  y += 1;
                }

                if (
                  !worldMap.roomStats[roomName] ||
                  !worldMap.roomStats[roomName].own
                ) {
                  continue;
                }

                var username =
                  worldMap.roomUsers[worldMap.roomStats[roomName].own.user]
                    .username;
                var allianceName = module.exports.userToAlliance[username];

                if (
                  module.exports.userToAlliance[username] &&
                  module.exports.alliances[allianceName]
                ) {
                  var id =
                    "alliance-1-" + sector.firstRoomName + "-" + roomName;

                  if (!document.getElementById(id)) {
                    var left = (x + 1) * 20 - 20;
                    var top = (y - 1) * 20;
                    var newEle = document.createElement("div");
                    var css = `z-index: 1;
                                    height: 20px;
                                    width: 20px;
                                    position: absolute;
                                    left: ${left}px;
                                    top: ${top}px;`;

                    if (module.config && module.config.background === "Image") {
                      var url =
                        "http://www.leagueofautomatednations.com/obj/" +
                        module.exports.alliances[allianceName].logo;

                      css += `background-image: url("${url}");
                                        background-size: 20px 20px;
                                        opacity : 0.2;`;
                    } else {
                      var c = module.exports.hexToRgb(
                        module.exports.alliances[allianceName].color,
                      );
                      c.a = 0.3;

                      css += `background: rgba(${c.r},${c.g},${c.b},${c.a});`;
                    }

                    newEle.id = id;
                    newEle.className = "room-prohibited";
                    newEle.setAttribute("style", css);
                    $sectorEle.append(newEle);
                  }
                }
              }
            }
          }
        }
      } else {
        $("div[id^=alliance-]").remove();
      }
    },
  );
};

module.exports.hexToRgb = function (hex) {
  if (!hex) {
    return {
      r: 255,
      g: 255,
      b: 255,
    };
  }

  var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function (m, r, g, b) {
    return r + r + g + g + b + b;
  });

  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};
