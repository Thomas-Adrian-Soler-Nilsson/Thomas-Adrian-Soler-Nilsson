import fs from 'node:fs/promises';
import path from 'node:path';

const USER = 'Thomas-Adrian-Soler-Nilsson';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = path.resolve('profile');
const API = 'https://api.github.com';

if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'profile-card-generator'
};

async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function graphql(query, variables) {
  return getJson('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function svgShell(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" rx="12" fill="#0d1117" stroke="#30363d"/>
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif} .muted{fill:#8b949e} .text{fill:#f0f6fc} .accent{fill:#58a6ff}</style>
  ${body}
</svg>`;
}

function bar(x, y, width, value, total) {
  const w = total ? Math.max(0, (width * value) / total) : 0;
  return `<rect x="${x}" y="${y}" width="${width}" height="8" rx="4" fill="#21262d"/><rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="#58a6ff"/>`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const user = await getJson(`${API}/users/${USER}`);
  const repos = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await getJson(`${API}/users/${USER}/repos?per_page=100&page=${page}&sort=updated`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const publicRepos = repos.filter(r => !r.fork);
  const totalStars = publicRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);

  const languages = {};
  for (const repo of publicRepos.slice(0, 100)) {
    const data = await getJson(repo.languages_url);
    for (const [name, bytes] of Object.entries(data)) languages[name] = (languages[name] || 0) + bytes;
  }
  const topLanguages = Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const languageTotal = topLanguages.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;

  const today = new Date();
  const from = new Date(today);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const contributionsQuery = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){totalCommitContributions{totalCount} totalIssueContributions{totalCount} totalPullRequestContributions{totalCount} contributionCalendar{totalContributions,weeks{contributionDays{date,contributionCount}}}}}}`;
  const gql = await graphql(contributionsQuery, {
    login: USER,
    from: from.toISOString(),
    to: today.toISOString()
  });
  if (gql.errors?.length) throw new Error(gql.errors.map(e => e.message).join('; '));

  const contributionCalendar = gql.data.user.contributionsCollection.contributionCalendar;
  const days = contributionCalendar.weeks.flatMap(w => w.contributionDays);
  const contributionCounts = days.map(d => ({ date: new Date(`${d.date}T00:00:00Z`), count: d.contributionCount })).sort((a, b) => b.date - a.date);

  let currentStreak = 0;
  let cursor = new Date(contributionCounts[0]?.date || today);
  for (const day of contributionCounts) {
    const diff = Math.round((cursor - day.date) / 86400000);
    if (diff === 0) continue;
    if (diff === 1 && day.count > 0) {
      currentStreak += 1;
      cursor = day.date;
    } else if (diff === 1 && currentStreak === 0 && day.count === 0) {
      cursor = day.date;
      break;
    } else {
      break;
    }
  }
  if (contributionCounts[0]?.count > 0) currentStreak = Math.max(1, currentStreak);

  let longestStreak = 0;
  let running = 0;
  for (const day of [...contributionCounts].sort((a, b) => a.date - b.date)) {
    if (day.count > 0) {
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else {
      running = 0;
    }
  }

  const statsBody = `
    <text x="28" y="38" class="text" font-size="18" font-weight="700">GitHub Stats</text>
    <text x="28" y="72" class="accent" font-size="27" font-weight="700">${formatNumber(user.public_repos || 0)}</text>
    <text x="28" y="94" class="muted" font-size="12">public repositories</text>
    <text x="178" y="72" class="accent" font-size="27" font-weight="700">${formatNumber(totalStars)}</text>
    <text x="178" y="94" class="muted" font-size="12">stars earned</text>
    <text x="328" y="72" class="accent" font-size="27" font-weight="700">${formatNumber(contributionCalendar.totalContributions)}</text>
    <text x="328" y="94" class="muted" font-size="12">contributions / year</text>
    <text x="28" y="133" class="accent" font-size="25" font-weight="700">${formatNumber(gql.data.user.contributionsCollection.totalCommitContributions.totalCount)}</text>
    <text x="28" y="153" class="muted" font-size="12">commits</text>
    <text x="178" y="133" class="accent" font-size="25" font-weight="700">${formatNumber(gql.data.user.contributionsCollection.totalPullRequestContributions.totalCount)}</text>
    <text x="178" y="153" class="muted" font-size="12">pull requests</text>
    <text x="328" y="133" class="accent" font-size="25" font-weight="700">${formatNumber(user.followers || 0)}</text>
    <text x="328" y="153" class="muted" font-size="12">followers</text>`;

  const langRows = topLanguages.map(([name, bytes], index) => {
    const y = 40 + index * 25;
    return `<text x="28" y="${y}" class="text" font-size="12">${esc(name)}</text>${bar(130, y - 9, 220, bytes, languageTotal)}<text x="370" y="${y}" class="muted" font-size="12">${((bytes / languageTotal) * 100).toFixed(1)}%</text>`;
  }).join('');
  const langBody = `<text x="28" y="38" class="text" font-size="18" font-weight="700">Top Languages</text>${langRows || '<text x="28" y="74" class="muted" font-size="13">No language data yet.</text>'}`;

  const streakBody = `
    <text x="28" y="38" class="text" font-size="18" font-weight="700">GitHub Streak</text>
    <text x="28" y="92" class="accent" font-size="36" font-weight="800">${currentStreak}</text>
    <text x="28" y="113" class="muted" font-size="12">current streak (days)</text>
    <text x="205" y="92" class="accent" font-size="36" font-weight="800">${longestStreak}</text>
    <text x="205" y="113" class="muted" font-size="12">longest streak</text>
    <text x="360" y="92" class="accent" font-size="36" font-weight="800">${formatNumber(contributionCalendar.totalContributions)}</text>
    <text x="360" y="113" class="muted" font-size="12">contributions / year</text>`;

  const achievementItems = [
    ['⭐', 'Stars', totalStars],
    ['📦', 'Repositories', user.public_repos || 0],
    ['🔥', 'Current streak', currentStreak],
    ['🏅', 'Longest streak', longestStreak],
    ['👥', 'Followers', user.followers || 0]
  ];
  const achievementBody = achievementItems.map(([icon, label, value], i) => {
    const x = 28 + i * 92;
    return `<text x="${x}" y="45" font-size="20">${icon}</text><text x="${x}" y="72" class="accent" font-size="19" font-weight="700">${formatNumber(value)}</text><text x="${x}" y="89" class="muted" font-size="10">${esc(label)}</text>`;
  }).join('');

  await fs.writeFile(path.join(OUT, 'stats.svg'), svgShell(520, 180, statsBody));
  await fs.writeFile(path.join(OUT, 'top-langs.svg'), svgShell(520, 210, langBody));
  await fs.writeFile(path.join(OUT, 'streak.svg'), svgShell(520, 155, streakBody));
  await fs.writeFile(path.join(OUT, 'trophy.svg'), svgShell(520, 120, achievementBody));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
