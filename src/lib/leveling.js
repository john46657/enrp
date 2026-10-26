// XP, die man braucht, um von Level `level` auf `level + 1` zu kommen.
const xpForNext = (level) => 5 * level * level + 50 * level + 100;

function levelInfo(totalXp) {
  let level = 0;
  let rest = totalXp;
  while (rest >= xpForNext(level)) {
    rest -= xpForNext(level);
    level++;
  }
  return { level, current: rest, needed: xpForNext(level) };
}

function progressBar(current, needed, size = 14) {
  const filled = Math.round((current / needed) * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

module.exports = { xpForNext, levelInfo, progressBar };
