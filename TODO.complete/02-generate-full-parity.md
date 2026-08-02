# 02 — Generate full-parity fixtures for all 289 maps

## Priority: P0

## Current State
- `test/fixtures/parity.json` has only 40 curated fixtures (14 maps)
- `test/fixtures/full-parity.json` has 7502 fixtures but lives in .gitignore
- 2 maps have no IR (bgnpcgn-tuk-Cyrl-Latn-1979/1993)

## Fix

### 1. Generate IR for missing maps
The 2 missing maps fail Ruby DSL parsing. Options:
- Fix the Ruby DSL bug, OR
- Generate IR via ISC parser (once NodeAdapter is built, see TODO.complete/00)

### 2. Commit full-parity fixtures
```bash
ruby scripts/full-parity.rb > test/fixtures/full-parity.json
git add test/fixtures/full-parity.json
git add test/fixtures/maps/*.json
git commit -m "test: commit full-parity fixtures for all 289 maps"
```

### 3. Replace curated parity test with full-parity
Update `test/parity.test.ts` to use `full-parity.json` instead of
the curated `parity.json`:
```typescript
const FIXTURES = resolve(FIXTURES_DIR, "full-parity.json")
const payload = JSON.parse(readFileSync(FIXTURES, "utf8"))
for (const fx of payload.samples) {
  it(`${fx.system_code}: ${JSON.stringify(fx.input)}`, () => {
    expect(transliterate(fx.system_code, fx.input)).toBe(fx.ruby_actual)
  })
}
```

### 4. CI integration
```yaml
# .github/workflows/parity.yml
- name: Regenerate fixtures
  run: |
    ruby scripts/full-parity.rb > test/fixtures/full-parity.json
    npx tsx scripts/full-parity.ts
- name: Check no drift
  run: git diff --exit-code test/fixtures/
```
