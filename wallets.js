/* Wallet card looks, one entry per wallet. Edit freely:
 * - from/to: card gradient; ink: text color (keep contrast high against both).
 * - mark: the wordmark shown when there is no logo file.
 * - logo: drop an official logo in icons/wallets/ and put its file name here, e.g. 'bca.svg'.
 * Keys match wallet names loosely: lowercase letters and digits, substring match ("Bank Jago" -> jago). */
self.WALLET_STYLES = {
  bca: { kind: 'bank', mark: 'BCA', from: '#005BAC', to: '#0A3F7D', ink: '#FFFFFF', logo: '' },
  cimbniaga: { kind: 'bank', mark: 'CIMB NIAGA', from: '#A6192E', to: '#5E0D1A', ink: '#FFFFFF', logo: '' },
  gopay: { kind: 'ewallet', mark: 'gopay', from: '#005C78', to: '#003B50', ink: '#FFFFFF', logo: '' },
  ovo: { kind: 'ewallet', mark: 'OVO', from: '#4C2A86', to: '#2A1650', ink: '#FFFFFF', logo: '' },
  shopeepay: { kind: 'ewallet', mark: 'ShopeePay', from: '#A82C16', to: '#6E1C0D', ink: '#FFFFFF', logo: '' },
  superbank: { kind: 'bank', mark: 'superbank', from: '#2B2F8F', to: '#15174D', ink: '#FFFFFF', logo: '' },
  seabank: { kind: 'bank', mark: 'SeaBank', from: '#953A0C', to: '#5A2309', ink: '#FFFFFF', logo: '' },
  jago: { kind: 'bank', mark: 'jago', from: '#F5B82E', to: '#E08A1E', ink: '#2B1A00', logo: '' },
  cash: { kind: 'cash', mark: 'Cash', from: '#22603D', to: '#123A23', ink: '#FFFFFF', logo: '' },
};
// Colors are slightly darker than the real brands so white text stays readable under the card's gloss.

// Wallets not listed above get one of these, picked by name so it stays stable.
self.WALLET_FALLBACKS = [
  ['#175693', '#0E3E6B'], ['#0A6357', '#064239'], ['#6940A5', '#3B2160'],
  ['#AD1A72', '#640E42'], ['#734A35', '#4E3124'], ['#37352F', '#191917'],
];

self.walletStyle = function (name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = Object.keys(self.WALLET_STYLES).find((k) => slug.includes(k));
  if (key) return { key, ...self.WALLET_STYLES[key] };
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const [from, to] = self.WALLET_FALLBACKS[h % self.WALLET_FALLBACKS.length];
  return { key: '', kind: 'bank', mark: String(name || ''), from, to, ink: '#FFFFFF', logo: '' };
};
