module.exports.nukes = [];
module.exports.activeTab = "battles";
module.exports.refreshTimer = null;

// See modules/map.nukes.js's initSharedCache for why this exists and why it
// must run inside a module.exports function rather than at the top level.
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
  console.log("Threat Radar: Init started");

  module.exports.initSharedCache();

  // Inject button immediately (waiting for UI)
  var attempts = 0;
  var checkExist = setInterval(function () {
    attempts++;
    // Try to find the specific list in the navbar
    // nav.menu > ol
    var navList = $("nav.menu > ol").first(); // Get the first list (Main Navigation)

    if (navList.length) {
      console.log("Threat Radar: Navbar list found, injecting button");
      clearInterval(checkExist);
      module.exports.injectSidebarButton(navList);
    } else {
      if (attempts % 10 === 0)
        console.log(
          "Threat Radar: Navbar not found yet (attempt " + attempts + ")...",
        );
    }
  }, 1000);

  // Initial load
  module.exports.fetchBattles();
  module.exports.fetchNukes();

  // Keep the modal's data fresh while it's open; unlike map.nukes.js this
  // module has no URL-based signal for "in use", so gate on modal visibility.
  module.exports.refreshTimer = setInterval(function () {
    if (!$("#threat-radar-modal").is(":visible")) {
      return;
    }
    module.exports.fetchBattles();
    module.exports.fetchNukes();
  }, 60000);
};

module.exports.fetchBattles = function () {
  $("#battle-radar-status").text("Fetching data...");

  module.dispatchEvent(
    {
      event: "xhttp",
      url: "https://www.leagueofautomatednations.com/vk/battles_full.json",
    },
    function (response) {
      console.log("Threat Radar: Battles data received", response);
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
          // Handle case where data might be wrapped in .battles
          module.exports.battles = parsed.battles;
        } else if (parsed && Array.isArray(parsed.records)) {
          // Handle case where data might be wrapped in .records (current API format)
          module.exports.battles = parsed.records;
        } else {
          console.warn("Threat Radar: Unexpected data format", parsed);
          module.exports.battles = [];
          throw new Error(
            "Data is not an array (checked root, .battles, and .records)",
          );
        }

        console.log(
          "Threat Radar: Loaded " + module.exports.battles.length + " battles",
        );
        $("#battle-radar-status").text(
          "Loaded " + module.exports.battles.length + " battles",
        );
      } catch (e) {
        console.error("Error parsing battles data:", e);
        module.exports.battles = []; // Fallback
        $("#battle-radar-status").text("Error: " + e.message);
      }

      // If modal is open on the Battles tab, update it
      if (
        $("#threat-radar-modal").is(":visible") &&
        module.exports.activeTab === "battles"
      ) {
        module.exports.renderBattles();
      }
    },
  );
};

module.exports.fetchNukes = function () {
  var shared = window.__scThreatCache;

  function finish(fetchFailed) {
    module.exports.refreshCurrentTicks(function () {
      if (!fetchFailed) {
        $("#nuke-radar-status").text(
          module.exports.nukes.length + " nukes loaded",
        );
      }

      // If modal is open on the Nukes tab, update it
      if (
        $("#threat-radar-modal").is(":visible") &&
        module.exports.activeTab === "nukes"
      ) {
        module.exports.renderNukes();
      }
    });
  }

  if (shared.nukes && Date.now() - shared.nukesFetchedAt < 10000) {
    module.exports.nukes = shared.nukes;
    finish(false);
    return;
  }

  $("#nuke-radar-status").text("Fetching data...");

  module.dispatchEvent(
    {
      event: "xhttp",
      url: "https://www.leagueofautomatednations.com/vk/nukes.json",
    },
    function (response) {
      console.log("Threat Radar: Nukes data received", response);
      var fetchFailed = false;

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
          console.warn("Threat Radar: Unexpected nuke data format", parsed);
          module.exports.nukes = [];
          throw new Error(
            "Data is not an array (checked root, .nukes, and .records)",
          );
        }

        console.log(
          "Threat Radar: Loaded " + module.exports.nukes.length + " nukes",
        );
      } catch (e) {
        console.error("Error parsing nukes data:", e);
        fetchFailed = true;
        module.exports.nukes = [];
        $("#nuke-radar-status").text("Error: " + e.message);
      }

      shared.nukes = module.exports.nukes;
      shared.nukesFetchedAt = Date.now();

      finish(fetchFailed);
    },
  );
};

module.exports.refreshCurrentTicks = function (cb) {
  var shards = {};
  (module.exports.nukes || []).forEach(function (nuke) {
    if (nuke.shard) {
      shards[nuke.shard] = true;
    }
  });

  var shardNames = Object.keys(shards);
  var remaining = shardNames.length;

  if (remaining === 0) {
    cb();
    return;
  }

  shardNames.forEach(function (shard) {
    module.exports.fetchCurrentTick(shard, function () {
      remaining--;
      if (remaining === 0) {
        cb();
      }
    });
  });
};

module.exports.fetchCurrentTick = function (shard, cb) {
  window.__scThreatCache.fetchCurrentTick(shard, cb);
};

module.exports.getTicksRemaining = function (nuke) {
  return window.__scThreatCache.getTicksRemaining(nuke);
};

module.exports.injectSidebarButton = function (container) {
  if ($("#threat-radar-li").length) {
    console.log("Threat Radar: Button already exists");
    return;
  }

  // Get Angular content attribute from a sibling to match encapsulation
  var sibling = container.children().first();
  var ngAttr = "";
  if (sibling.length) {
    $.each(sibling[0].attributes, function () {
      if (this.name.startsWith("_ngcontent")) {
        ngAttr = this.name;
        return false; // break
      }
    });
  }
  console.log("Threat Radar: Found Angular attribute: " + ngAttr);
  var attrStr = ngAttr ? ` ${ngAttr}=""` : "";

  var radarSvg = module.exports.getRadarSvg();

  // Create LI element matching the existing structure with Angular attribute
  var li = $(`<li id="threat-radar-li" class=""${attrStr}>
        <a class="menu__item" style="cursor: pointer;"${attrStr}>
            <svg class="__icon"${attrStr} viewBox="0 0 24 24">
                ${radarSvg}
            </svg>
            <div class="--flex --column"${attrStr}>
                <div${attrStr}>Threat Radar</div>
            </div>
        </a>
        <svg class="__dust"${attrStr}><use xlink:href="#symbol-menu-dust"${attrStr}></use></svg>
    </li>`);

  // Append to the end of the first list
  container.append(li);
  console.log("Threat Radar: LI appended to navbar");

  // Add hover effect if needed, though CSS should handle it if attributes match
  li.find("a").hover(
    function () {
      $(this).css("opacity", "1");
    }, // Example fix if needed
    function () {
      $(this).css("opacity", "");
    },
  );

  li.find("a").click(function (e) {
    e.preventDefault(); // Prevent default anchor behavior
    module.exports.openModal();
  });
};

module.exports.openModal = function () {
  if ($("#threat-radar-modal").length) {
    $("#threat-radar-modal").show();
    module.exports.updateTabUI(); // Re-render in case of updates
    return;
  }

  var modalHtml = `
    <div id="threat-radar-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center;">
        <div style="background: #222; width: 90%; max-width: 1200px; max-height: 90%; overflow-y: auto; padding: 20px; border: 1px solid #444; color: #eee; font-family: Roboto, sans-serif; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid #444; padding-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <h2 style="margin: 0;">Threat Radar</h2>
                    <button id="threat-radar-refresh" style="background: #444; color: #fff; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px;">Refresh</button>
                    <span id="battle-radar-status" style="font-size: 0.9em; color: #aaa;"></span>
                    <span id="nuke-radar-status" style="font-size: 0.9em; color: #aaa;"></span>
                </div>
                <button id="threat-radar-close" style="background: none; border: none; color: #888; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button id="radar-tab-battles" style="background: #444; color: #fff; border: none; padding: 6px 14px; cursor: pointer; border-radius: 3px;">Battles</button>
                <button id="radar-tab-nukes" style="background: #333; color: #aaa; border: none; padding: 6px 14px; cursor: pointer; border-radius: 3px;">Nukes</button>
            </div>
            <div id="battle-radar-content" style="display: flex; flex-wrap: wrap; gap: 10px;">
                <p>Loading battles...</p>
            </div>
            <div id="nuke-radar-content" style="display: none; flex-wrap: wrap; gap: 10px;">
                <p>Loading nukes...</p>
            </div>
        </div>
    </div>
    `;

  $("body").append(modalHtml);

  $("#threat-radar-close").click(function () {
    $("#threat-radar-modal").hide();
  });

  $("#threat-radar-refresh").click(function () {
    module.exports.fetchBattles();
    module.exports.fetchNukes();
  });

  $("#radar-tab-battles").click(function () {
    module.exports.activeTab = "battles";
    module.exports.updateTabUI();
  });

  $("#radar-tab-nukes").click(function () {
    module.exports.activeTab = "nukes";
    module.exports.updateTabUI();
  });

  module.exports.updateTabUI();
};

// Data-driven so adding a future tab means adding one entry here, not a new
// branch in every toggle site.
module.exports.tabs = {
  battles: {
    contentSelector: "#battle-radar-content",
    statusSelector: "#battle-radar-status",
    tabSelector: "#radar-tab-battles",
    render: function () {
      module.exports.renderBattles();
    },
  },
  nukes: {
    contentSelector: "#nuke-radar-content",
    statusSelector: "#nuke-radar-status",
    tabSelector: "#radar-tab-nukes",
    render: function () {
      module.exports.renderNukes();
    },
  },
};

module.exports.updateTabUI = function () {
  var activeTab = module.exports.activeTab;

  Object.keys(module.exports.tabs).forEach(function (tabName) {
    var tab = module.exports.tabs[tabName];
    var isActive = tabName === activeTab;

    $(tab.contentSelector).css("display", isActive ? "flex" : "none");
    $(tab.statusSelector).css("display", isActive ? "inline" : "none");
    $(tab.tabSelector).css({
      background: isActive ? "#444" : "#333",
      color: isActive ? "#fff" : "#aaa",
    });
  });

  module.exports.tabs[activeTab].render();
};

module.exports.renderBattles = function () {
  var content = $("#battle-radar-content");
  content.empty();

  if (!module.exports.battles) {
    content.html("<p>Loading battles data...</p>");
    $("#battle-radar-status").text("No data yet");
    return;
  }

  if (!Array.isArray(module.exports.battles)) {
    console.error(
      "Threat Radar: battles is not an array",
      module.exports.battles,
    );
    // Try to recover if it's an object with numeric keys (unlikely but possible)
    if (module.exports.battles && typeof module.exports.battles === "object") {
      module.exports.battles = Object.values(module.exports.battles);
      if (!Array.isArray(module.exports.battles)) {
        module.exports.battles = [];
      }
    } else {
      module.exports.battles = [];
    }
  }

  // Filter by current shard
  var currentShard = module.getCurrentShard();
  console.log("Threat Radar: Current shard: " + currentShard);

  var filteredBattles = module.exports.battles;
  if (currentShard) {
    filteredBattles = module.exports.battles.filter(function (battle) {
      return battle.shard === currentShard;
    });
  }

  if (filteredBattles.length === 0) {
    content.html(
      "<p>No active battles found" +
        (currentShard ? " in " + currentShard : "") +
        ".</p>",
    );
    $("#battle-radar-status").text(
      "0 battles" + (currentShard ? " (" + currentShard + ")" : ""),
    );
    return;
  }

  $("#battle-radar-status").text(
    filteredBattles.length +
      " battles" +
      (currentShard ? " (" + currentShard + ")" : ""),
  );

  // Sort battles by classification (level) descending
  var sortedBattles = filteredBattles.sort(
    (a, b) => b.classification - a.classification,
  );

  sortedBattles.forEach(function (battle) {
    var color = module.exports.getBattleColor(battle.classification);
    var shardUrl =
      battle.lastpvptick !== undefined
        ? `https://screeps.com/a/#!/history/${battle.shard}/${battle.room}?t=${battle.lastpvptick}`
        : `https://screeps.com/a/#!/room/${battle.shard}/${battle.room}`;

    // Format dates relative or short
    var lastSeen = new Date(battle.lastseen).toLocaleString();

    var participants = module.exports.getBattleParticipants(battle);

    var card = `
        <div style="background: #333; border-left: 5px solid ${color}; padding: 10px; width: 300px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">
            <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 5px; display: flex; justify-content: space-between;">
                <a href="${shardUrl}" target="_blank" style="color: #eee; text-decoration: none;">${battle.room} <span style="font-size: 0.8em; color: #aaa;">(${battle.shard})</span></a>
                <span style="background: ${color}; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.8em;">Lvl ${battle.classification}</span>
            </div>
            <div style="font-size: 0.9em; color: #ccc;">
                <div>${participants.attackers} &rarr; ${participants.defenders}</div>
                <div>Last Seen: ${lastSeen}</div>
                <div>ID: ${battle.battleid}</div>
            </div>
        </div>
        `;
    content.append(card);
  });
};

// Battle records may have zero, one, or multiple participants per role
// (e.g. multi-player fights), so this groups by role rather than assuming
// a single attacker/defender pair like nuke records have.
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

module.exports.renderNukes = function () {
  var content = $("#nuke-radar-content");
  content.empty();

  if (!Array.isArray(module.exports.nukes)) {
    module.exports.nukes = [];
  }

  // Filter by current shard
  var currentShard = module.getCurrentShard();
  console.log("Threat Radar: Current shard: " + currentShard);

  var filteredNukes = module.exports.nukes;
  if (currentShard) {
    filteredNukes = module.exports.nukes.filter(function (nuke) {
      return nuke.shard === currentShard;
    });
  }

  if (filteredNukes.length === 0) {
    content.html(
      "<p>No incoming nukes found" +
        (currentShard ? " in " + currentShard : "") +
        ".</p>",
    );
    $("#nuke-radar-status").text(
      "0 nukes" + (currentShard ? " (" + currentShard + ")" : ""),
    );
    return;
  }

  $("#nuke-radar-status").text(
    filteredNukes.length +
      " nukes" +
      (currentShard ? " (" + currentShard + ")" : ""),
  );

  // Sort nukes by ticks remaining ascending (most urgent first); unknown
  // ticks (current tick lookup failed) sort last.
  var sortedEntries = filteredNukes
    .map(function (nuke) {
      return { nuke: nuke, ticksRemaining: module.exports.getTicksRemaining(nuke) };
    })
    .sort(function (a, b) {
      if (a.ticksRemaining === undefined && b.ticksRemaining === undefined) {
        return 0;
      }
      if (a.ticksRemaining === undefined) {
        return 1;
      }
      if (b.ticksRemaining === undefined) {
        return -1;
      }
      return a.ticksRemaining - b.ticksRemaining;
    });

  sortedEntries.forEach(function (entry) {
    var nuke = entry.nuke;
    var ticksRemaining = entry.ticksRemaining;
    var color = module.exports.getNukeColor(ticksRemaining);
    var url = module.exports.getNukeLink(nuke, ticksRemaining);
    var impactText =
      ticksRemaining !== undefined
        ? ticksRemaining + " ticks until impact"
        : "Impact tick: " + nuke.landTime;

    var card = `
        <div style="background: #333; border-left: 5px solid ${color}; padding: 10px; width: 300px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">
            <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 5px; display: flex; justify-content: space-between;">
                <a href="${url}" target="_blank" style="color: #eee; text-decoration: none;">${nuke.room} <span style="font-size: 0.8em; color: #aaa;">(${nuke.shard})</span></a>
                <span style="background: ${color}; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.8em;">Lvl ${nuke.level}</span>
            </div>
            <div style="font-size: 0.9em; color: #ccc;">
                <div>${impactText}</div>
                <div>Launched from: ${nuke.launchRoom}</div>
                <div>${nuke.attacker} &rarr; ${nuke.defender}</div>
            </div>
        </div>
        `;
    content.append(card);
  });
};

module.exports.getBattleColor = function (classification) {
  // Distinct colors for battle levels
  var level = parseInt(classification) || 0;

  switch (level) {
    case 0:
      return "#A9A9A9"; // DarkGray
    case 1:
      return "#00CED1"; // DarkTurquoise
    case 2:
      return "#FFD700"; // Gold
    case 3:
      return "#FF8C00"; // DarkOrange
    case 4:
      return "#FF4500"; // OrangeRed
    case 5:
      return "#DC143C"; // Crimson
    case 6:
      return "#FF00FF"; // Magenta
    case 7:
      return "#8B008B"; // DarkMagenta
    default:
      if (level > 7) return "#FF0000"; // Pure Red
      return "#FFFFFF"; // White
  }
};

module.exports.getNukeColor = function (ticksRemaining) {
  return window.__scThreatCache.getNukeColor(ticksRemaining);
};

module.exports.getNukeLink = function (nuke, ticksRemaining) {
  return window.__scThreatCache.getNukeLink(nuke, ticksRemaining);
};

module.exports.getRadarSvg = function () {
  // Return path only, as it's wrapped in svg with class __icon
  // Use currentColor for fill to match native icons (which are usually white/grey)
  // and use opacity or color class if needed.
  // Native icons seem to have no fill color specified in HTML, relying on CSS 'fill' property on svg.
  // So we should remove fill attribute or set it to currentColor.
  return `<path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12C20,14.4 19.18,16.6 17.81,18.33L16.4,16.92C17.39,15.58 18,13.88 18,12A6,6 0 0,0 12,6V4M12,8A4,4 0 0,0 8,12C8,13.3 8.63,14.45 9.61,15.2L8.2,16.61C6.83,15.42 6,13.8 6,12A6,6 0 0,1 12,6V8Z" />`;
};

module.exports.update = function () {
  // Optional: Auto-refresh data periodically
};
