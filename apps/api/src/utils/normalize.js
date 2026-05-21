function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function intersectsNormalized(left, right) {
  const rightSet = new Set(right.map(normalize));
  return left.some((value) => rightSet.has(normalize(value)));
}

module.exports = {
  normalize,
  intersectsNormalized
};
