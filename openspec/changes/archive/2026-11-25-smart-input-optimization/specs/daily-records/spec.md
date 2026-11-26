## MODIFIED Requirements

### Requirement: Smart defaults endpoint for low-friction entry
The system SHALL provide `GET /api/records/defaults` returning habit-based feeding, sleep, health, and care defaults computed from recent stored records (including breastfeeding mode/duration, paired solid food portions, and median-based sleep durations) so the client can prefill forms and suggest next actions with minimal typing.

#### Scenario: Compute smart defaults from recent history
- **WHEN** an authenticated administrator with existing feeding, sleep, health, and care records calls `GET /api/records/defaults`
- **THEN** the server responds with HTTP 200 containing the latest formula/bottle `amount_ml`, top 3 frequent milk amounts, `last_feeding_subtype`, `last_milk_subtype` (latest `formula` or `breast` ignoring `solid`), `last_breast_mode`, `last_breast_duration_min`, the last direct breastfeeding side and suggested opposite side, deduplicated paired `recent_solids` (`{ food, amount }`), median-based `sleep.suggested_nap_min` and `sleep.suggested_night_min`, latest temperature value, recent medicine names with dosages, and recent custom care titles

#### Scenario: Return sensible starter defaults when history is empty
- **WHEN** an authenticated administrator with no records yet calls `GET /api/records/defaults`
- **THEN** the server responds with HTTP 200 with sensible fallback presets (including standard milk amount options, `last_milk_subtype: "formula"`, `last_breast_mode: "direct"`, `last_breast_duration_min: 15`, `recent_solids: []`, `sleep.suggested_nap_min: 60`, `sleep.suggested_night_min: 480`, and default temperature `36.6`) without error
