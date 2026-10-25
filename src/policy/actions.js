/**
 * Action vocabulary shared by the policy and the HTTP contract.
 *
 * `warn` is accepted for backwards compatibility with old dictionaries and is
 * normalized to `review`; the game server only understands the four actions
 * below.
 */
const ACTION_RANK = Object.freeze({
  allow: 0,
  warn: 1,
  review: 2,
  replace: 3,
  block: 4,
});

const ACTIONS = Object.freeze(['allow', 'review', 'replace', 'block']);

// rank 1 is `warn`, which the wire protocol never sees.
const ACTION_BY_RANK = Object.freeze({
  0: 'allow',
  1: 'review',
  2: 'review',
  3: 'replace',
  4: 'block',
});

function normalizeAction(action, fallback = 'replace') {
  if (action === 'warn') return 'review';
  return ACTION_RANK[action] !== undefined ? action : fallback;
}

function rankOf(action) {
  return ACTION_RANK[normalizeAction(action, 'allow')];
}

function maxOf(left, right) {
  return rankOf(right) > rankOf(left) ? normalizeAction(right) : normalizeAction(left);
}

function elevate(action, steps = 1) {
  const rank = Math.min(4, rankOf(action) + Math.max(0, steps));
  return ACTION_BY_RANK[rank];
}

function capAction(action, cap) {
  return rankOf(action) > rankOf(cap) ? normalizeAction(cap) : normalizeAction(action);
}

function actionForRank(rank) {
  return ACTION_BY_RANK[Math.max(0, Math.min(4, rank))];
}

module.exports = {
  ACTION_RANK,
  ACTIONS,
  normalizeAction,
  rankOf,
  maxOf,
  elevate,
  capAction,
  actionForRank,
};
