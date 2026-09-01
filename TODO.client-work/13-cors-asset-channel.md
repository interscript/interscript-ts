# 13-cors-asset-channel

E3 bench finding (2026-09-01): browsers CANNOT fetch GH Releases assets
cross-origin — the github.com/releases/download redirect hop lacks
Access-Control-Allow-Origin. The live /neural demo fails with
"Failed to fetch" before any download.

Fix (scoped): the api worker serves `/v1/assets/{tag}/{file}` as a
streaming CORS-enabled proxy to the GH Release asset (workers stream
pass-through; no memory concern). The demo passes that index URL
explicitly to imf.resolve/IMFModel.load. Re-run E3 after.

Status: FOUND (blocking item 12 and the live demo's model path).
