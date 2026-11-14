### 🌊 Breakwater: 4 breaking changes reach **100% of active installs** (1,320 of 1,320)

| Change | Field | Read by | Installs |
|---|---|---|---:|
| Type changed (integer → string) | `GET /orders/:*` → `eta` | android 5.0.0; ios 5.0.0; web 2026.11.2 | 863 (65%) |
| Removed | `GET /me` → `loyalty` | android 4.4.0–4.5.2; ios 4.2.0–4.5.0 | 457 (35%) |
| Removed | `GET /orders/:*` → `courier.phone` | android 4.4.0–4.5.2; ios 4.2.0–4.5.0 | 457 (35%) |
| Now nullable | `GET /restaurants` → `[].rating` | android 4.4.0–4.5.2; ios 4.2.0–4.5.0 | 457 (35%) |

<details><summary>2 other changes touch fields no active version read in the last 30 days</summary>

- Removed: `GET /orders/:*` → `legacyTip`
- Endpoint removed: `GET /promos/legacy`

</details>

<sub>Based on field reads observed from 1,320 active installs over 30 days. A field read only on screens nobody opened in that window looks unused: treat "not read" as strong evidence, not proof.</sub>