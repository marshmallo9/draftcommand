let rankings = [];
let team = [];
let league = { teams: 12 };

function loadESPN() {
  alert("ESPN rankings fetch would run here.");
}

function parseRankings() {
  const text = document.getElementById("rankingsInput").value.trim();
  rankings = text.split("\n").map((line, i) => {
    return {
      name: line.trim(),
      rank: i + 1,
      round: Math.ceil((i + 1) / league.teams)
    };
  });
  alert("Rankings loaded.");
}

function parseTeam() {
  const text = document.getElementById("teamInput").value.trim();
  team = text.split("\n").map(line => {
    return { name: line.trim() };
  });
  buildKeeperTable();
}

function parseLeague() {
  const text = document.getElementById("leagueInput").value;
  if (text.includes("Max Teams:")) {
    const match = text.match(/Max Teams:\s*(\d+)/);
    if (match) league.teams = parseInt(match[1]);
  }
  alert("League settings loaded: " + league.teams + " teams.");
}

function buildKeeperTable() {
  const table = document.getElementById("keeperTable");
  table.innerHTML = `
    <tr>
      <th>Player</th>
      <th>Round</th>
      <th>Status</th>
      <th>Keep?</th>
    </tr>
  `;

  const usedRounds = new Set();

  team.forEach(player => {
    const rankData = rankings.find(r => r.name.toLowerCase().includes(player.name.toLowerCase()));
    const round = rankData ? rankData.round : "?";
    const conflict = usedRounds.has(round);

    const row = document.createElement("tr");
    row.className = conflict ? "keeper-conflict" : "keeper-ok";

    row.innerHTML = `
      <td>${player.name}</td>
      <td>${round}</td>
      <td>${conflict ? "Conflict" : "OK"}</td>
      <td><input type="checkbox" ${conflict ? "disabled" : ""}></td>
    `;

    if (!conflict && round !== "?") usedRounds.add(round);
    table.appendChild(row);
  });
}

// --- Analyst Insights (podcast-insights backend) ---

async function loadInsights() {
  const list = document.getElementById("insightsList");
  const player = document.getElementById("insightPlayer").value.trim();
  const position = document.getElementById("insightPosition").value.trim();
  const analyst = document.getElementById("insightAnalyst").value.trim();

  const params = new URLSearchParams();
  if (player) params.set("player", player);
  if (position) params.set("position", position);
  if (analyst) params.set("analyst", analyst);

  const base = window.INSIGHTS_API_BASE || "http://localhost:3001";
  list.innerHTML = "<p class=\"subtext\">Loading…</p>";

  let insights;
  try {
    const res = await fetch(`${base}/api/insights?${params.toString()}`);
    if (!res.ok) throw new Error(`Backend responded ${res.status}`);
    insights = await res.json();
  } catch (err) {
    list.innerHTML = `<p class="subtext">Couldn't reach the insights backend (${base}). Is it running? See backend/README.md.</p>`;
    return;
  }

  if (!insights.length) {
    list.innerHTML = "<p class=\"subtext\">No insights match that search.</p>";
    return;
  }

  list.innerHTML = insights.map(renderInsightCard).join("");
}

function renderInsightCard(i) {
  return `
    <div class="insight-card">
      <div class="insight-meta">
        ${i.position ? `<span class="chip">${i.position}</span>` : ""}
        <span class="insight-player">${i.player}</span>
        ${i.date ? `<span class="insight-date">${i.date}</span>` : ""}
      </div>
      <div class="insight-source">
        <b>${i.analyst}</b>${i.podcast ? ` (${i.podcast})` : ""}
        ${i.opinion ? `<span class="opinion-badge">${i.opinion}</span>` : ""}
        ${i.timestamp ? `<span class="insight-timestamp">@ ${i.timestamp}</span>` : ""}
      </div>
      <div class="insight-quote">&ldquo;${i.quote}&rdquo;</div>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", loadInsights);
