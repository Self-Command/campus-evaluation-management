const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; };
export class Rational {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (!d) throw new Error("分母不能为零");
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d); this.n = n / g; this.d = d / g;
  }
  static from(value: string) {
    if (!/^-?\d{1,10}(?:\.\d{1,12})?$/.test(value)) throw new Error("数值需为十进制，整数最多10位、小数最多12位");
    const [whole, fraction = ""] = value.split(".");
    const sign = value.startsWith("-") ? -1n : 1n;
    return new Rational(BigInt(whole.replace("-", "") + fraction) * sign, 10n ** BigInt(fraction.length));
  }
  add(v: Rational) { return new Rational(this.n * v.d + v.n * this.d, this.d * v.d); }
  sub(v: Rational) { return this.add(new Rational(-v.n, v.d)); }
  mul(v: Rational) { return new Rational(this.n * v.n, this.d * v.d); }
  div(v: Rational) { return new Rational(this.n * v.d, this.d * v.n); }
  compare(v: Rational) { const n = this.n * v.d - v.n * this.d; return n < 0n ? -1 : n > 0n ? 1 : 0; }
  exact() { return { numerator: this.n.toString(), denominator: this.d.toString() }; }
  fixed(places = 2) {
    const negative = this.n < 0n, n = negative ? -this.n : this.n;
    const factor = 10n ** BigInt(places);
    const scaled = n * factor;
    let rounded = scaled / this.d;
    if ((scaled % this.d) * 2n >= this.d) rounded++;
    const digits = rounded.toString().padStart(places + 1, "0");
    return `${negative && rounded ? "-" : ""}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
  }
}
