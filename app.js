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
