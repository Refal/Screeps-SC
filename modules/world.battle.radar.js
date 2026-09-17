module.exports.init = function () {
  console.log("Battle Radar: Init started");

  // Inject button immediately (waiting for UI)
  var attempts = 0;
  var checkExist = setInterval(function () {
    attempts++;
    // Try to find the specific list in the navbar
    // nav.menu > ol
    var navList = $("nav.menu > ol").first(); // Get the first list (Main Navigation)

    if (navList.length) {
      console.log("Battle Radar: Navbar list found, injecting button");
      clearInterval(checkExist);
      module.exports.injectSidebarButton(navList);
    } else {
      if (attempts % 10 === 0)
        console.log(
          "Battle Radar: Navbar not found yet (attempt " + attempts + ")...",
        );
    }
  }, 1000);

  // Initial load
  module.exports.fetchBattles();
};

module.exports.fetchBattles = function () {
  $("#battle-radar-status").text("Fetching data...");

  module.dispatchEvent(
    {
      event: "xhttp",
      url: "https://www.leagueofautomatednations.com/vk/battles_full.json",
    },
    function (response) {
      console.log("Battle Radar: Battles data received", response);
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
          console.warn("Battle Radar: Unexpected data format", parsed);
          module.exports.battles = [];
          throw new Error(
            "Data is not an array (checked root, .battles, and .records)",
          );
        }

        console.log(
          "Battle Radar: Loaded " + module.exports.battles.length + " battles",
        );
        $("#battle-radar-status").text(
          "Loaded " + module.exports.battles.length + " battles",
        );
      } catch (e) {
        console.error("Error parsing battles data:", e);
        module.exports.battles = []; // Fallback
        $("#battle-radar-status").text("Error: " + e.message);
      }

      // If modal is open, update it
      if ($("#battle-radar-modal").is(":visible")) {
        module.exports.renderBattles();
      }
    },
  );
};

module.exports.injectSidebarButton = function (container) {
  if ($("#battle-radar-li").length) {
    console.log("Battle Radar: Button already exists");
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
  console.log("Battle Radar: Found Angular attribute: " + ngAttr);
  var attrStr = ngAttr ? ` ${ngAttr}=""` : "";

  var radarSvg = module.exports.getRadarSvg();

  // Create LI element matching the existing structure with Angular attribute
  var li = $(`<li id="battle-radar-li" class=""${attrStr}>
        <a class="menu__item" style="cursor: pointer;"${attrStr}>
            <svg class="__icon"${attrStr} viewBox="0 0 24 24">
                ${radarSvg}
            </svg>
            <div class="--flex --column"${attrStr}>
                <div${attrStr}>Battle Radar</div>
            </div>
        </a>
        <svg class="__dust"${attrStr}><use xlink:href="#symbol-menu-dust"${attrStr}></use></svg>
    </li>`);

  // Append to the end of the first list
  container.append(li);
  console.log("Battle Radar: LI appended to navbar");

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
  if ($("#battle-radar-modal").length) {
    $("#battle-radar-modal").show();
    module.exports.renderBattles(); // Re-render in case of updates
    return;
  }

  var modalHtml = `
    <div id="battle-radar-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center;">
        <div style="background: #222; width: 90%; max-width: 1200px; max-height: 90%; overflow-y: auto; padding: 20px; border: 1px solid #444; color: #eee; font-family: Roboto, sans-serif; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid #444; padding-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <h2 style="margin: 0;">Battle Radar</h2>
                    <button id="battle-radar-refresh" style="background: #444; color: #fff; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px;">Refresh</button>
                    <span id="battle-radar-status" style="font-size: 0.9em; color: #aaa;"></span>
                </div>
                <button id="battle-radar-close" style="background: none; border: none; color: #888; font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            <div id="battle-radar-content" style="display: flex; flex-wrap: wrap; gap: 10px;">
                <p>Loading battles...</p>
            </div>
        </div>
    </div>
    `;

  $("body").append(modalHtml);

  $("#battle-radar-close").click(function () {
    $("#battle-radar-modal").hide();
  });

  $("#battle-radar-refresh").click(function () {
    module.exports.fetchBattles();
  });

  module.exports.renderBattles();
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
      "Battle Radar: battles is not an array",
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
  console.log("Battle Radar: Current shard: " + currentShard);

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

    var card = `
        <div style="background: #333; border-left: 5px solid ${color}; padding: 10px; width: 300px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">
            <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 5px; display: flex; justify-content: space-between;">
                <a href="${shardUrl}" target="_blank" style="color: #eee; text-decoration: none;">${battle.room} <span style="font-size: 0.8em; color: #aaa;">(${battle.shard})</span></a>
                <span style="background: ${color}; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.8em;">Lvl ${battle.classification}</span>
            </div>
            <div style="font-size: 0.9em; color: #ccc;">
                <div>Last Seen: ${lastSeen}</div>
                <div>ID: ${battle.battleid}</div>
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
