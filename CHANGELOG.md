# Changelog

## [0.4.0](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.3.0...v0.4.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* **sheets:** character and adversary documents hold `sheet` (JSON) instead of `source` (YAML), and PATCH /api/characters/<id> takes `sheet`.

### Features

* **charts:** double-clicking a pin opens its linked note ([#47](https://github.com/ArnauFauquer/Realm-Keeper/issues/47)) ([bda6894](https://github.com/ArnauFauquer/Realm-Keeper/commit/bda689484841c9edf4a2c5f87ff0273632401670))
* **sheets:** build sheets with a visual builder, stored as JSON ([#49](https://github.com/ArnauFauquer/Realm-Keeper/issues/49)) ([899098e](https://github.com/ArnauFauquer/Realm-Keeper/commit/899098e9ffcf08148b35fccf09228bd690dcc3b3))


### Bug Fixes

* architecture review — data-loss races, a non-blocking event loop, and shared building blocks ([#50](https://github.com/ArnauFauquer/Realm-Keeper/issues/50)) ([c535a0d](https://github.com/ArnauFauquer/Realm-Keeper/commit/c535a0d9408fe4c9db733e105b5c5bc7a1bc2873))
* **observatory:** a card dragged within the gallery is moved, not its thumbnail imported ([#46](https://github.com/ArnauFauquer/Realm-Keeper/issues/46)) ([89c38ea](https://github.com/ArnauFauquer/Realm-Keeper/commit/89c38eafd5b0d2987daa1f870fd2471b5bceeb81))

## [0.3.0](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.2.3...v0.3.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* **observatory:** the bucket layout and image URLs change. Run backend/scripts/migrate_to_observatory.py against the bucket (--copy-only before the deploy, --apply after it), and with --vault on a checkout of the vault to rewrite the notes' image links.

### Features

* **dice:** a roll with no sheet behind it shows the player who rolled it ([#41](https://github.com/ArnauFauquer/Realm-Keeper/issues/41)) ([718ee28](https://github.com/ArnauFauquer/Realm-Keeper/commit/718ee28718a4d041b234458db10cba7f8ca08ddb))
* **notes:** roll tables, a table headed by a die rolls on itself ([#45](https://github.com/ArnauFauquer/Realm-Keeper/issues/45)) ([7682462](https://github.com/ArnauFauquer/Realm-Keeper/commit/7682462bbc7392ac9eac330bf5eec9106a82e353))
* **observatory:** one file manager for every document and image ([#40](https://github.com/ArnauFauquer/Realm-Keeper/issues/40)) ([ba90287](https://github.com/ArnauFauquer/Realm-Keeper/commit/ba9028761782a656f898c4e3150816d381f76caf))

## [0.2.3](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.2.2...v0.2.3) (2026-10-04)


### Features

* **sheets:** characters and adversaries are documents, shown in notes with a link ([#38](https://github.com/ArnauFauquer/Realm-Keeper/issues/38)) ([3069771](https://github.com/ArnauFauquer/Realm-Keeper/commit/3069771d7ee5c331556c0eebe9211bfea543ed74))

## [0.2.2](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.2.1...v0.2.2) (2026-10-04)


### Features

* **sheets:** tabs for long sheets, and no repeated name under the note title ([#36](https://github.com/ArnauFauquer/Realm-Keeper/issues/36)) ([5ed348f](https://github.com/ArnauFauquer/Realm-Keeper/commit/5ed348f4343bd30db3c7a5d4870c66626a69fa3d))

## [0.2.1](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.2.0...v0.2.1) (2026-10-04)


### Bug Fixes

* **sheets:** stat labels on one line, a visible leader, counters that fit a phone ([#34](https://github.com/ArnauFauquer/Realm-Keeper/issues/34)) ([da60c49](https://github.com/ArnauFauquer/Realm-Keeper/commit/da60c49a6c8df8468f492ee3d2dea29ef2b1c923))

## [0.2.0](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.84...v0.2.0) (2026-10-04)


### ⚠ BREAKING CHANGES

* **sheets:** sheets with a top-level `resources` must move it into a section's `counters`.

### Features

* **sheets:** counters live in sections; top-level resources is gone ([#31](https://github.com/ArnauFauquer/Realm-Keeper/issues/31)) ([4f39c24](https://github.com/ArnauFauquer/Realm-Keeper/commit/4f39c24245222494a27ab4f798f289ba79a56f9c))

## [0.1.84](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.83...v0.1.84) (2026-10-04)


### Features

* **sheets:** grouped counters, foldable sections and compact rows ([#29](https://github.com/ArnauFauquer/Realm-Keeper/issues/29)) ([1ecab6f](https://github.com/ArnauFauquer/Realm-Keeper/commit/1ecab6f3afc4a94a648cf2fbbe0922ebe47157df))

## [0.1.83](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.82...v0.1.83) (2026-10-04)


### Features

* **sheets:** full-width sheets with groups of stats, columns and tables ([#27](https://github.com/ArnauFauquer/Realm-Keeper/issues/27)) ([19088b1](https://github.com/ArnauFauquer/Realm-Keeper/commit/19088b13b63d2f2be430f62cad8405874ecbf8e9))

## [0.1.82](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.81...v0.1.82) (2026-10-04)


### Features

* **characters:** one document per character, and a gallery to manage them ([#25](https://github.com/ArnauFauquer/Realm-Keeper/issues/25)) ([82b7634](https://github.com/ArnauFauquer/Realm-Keeper/commit/82b7634e3bfe25c5ed0fa9e1fce9b3659895529e))

## [0.1.81](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.80...v0.1.81) (2026-10-04)


### Features

* sheets, encounters, battlemaps and one document layer (charts and vistas move to S3) ([#23](https://github.com/ArnauFauquer/Realm-Keeper/issues/23)) ([a9d6c0a](https://github.com/ArnauFauquer/Realm-Keeper/commit/a9d6c0ab29e02f1445f70cc6da527bc714192d37))

## [0.1.80](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.79...v0.1.80) (2026-10-03)


### Features

* **graph:** faster Constellation on canvas, and show it on /screen ([#22](https://github.com/ArnauFauquer/Realm-Keeper/issues/22)) ([162bacb](https://github.com/ArnauFauquer/Realm-Keeper/commit/162bacb21372e834b203c07998b4dce2ddee3a3c))


### Bug Fixes

* **canvas:** allow dragging assets and chart annotations on touch screens ([#20](https://github.com/ArnauFauquer/Realm-Keeper/issues/20)) ([ef67652](https://github.com/ArnauFauquer/Realm-Keeper/commit/ef67652d4d91f267679af72024e7fba1a7514a36))

## [0.1.79](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.78...v0.1.79) (2026-10-03)


### Features

* **dice:** give each signed-in player their own dice colour ([#18](https://github.com/ArnauFauquer/Realm-Keeper/issues/18)) ([d7a26bb](https://github.com/ArnauFauquer/Realm-Keeper/commit/d7a26bbc12a857764184fcc9a17f12d8988751d6))
* **screen:** mirror chart and vista edits on the screen live ([#17](https://github.com/ArnauFauquer/Realm-Keeper/issues/17)) ([4a6e903](https://github.com/ArnauFauquer/Realm-Keeper/commit/4a6e90312c5525f77c6f324130063072f41c5850))

## [0.1.78](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.77...v0.1.78) (2026-10-02)


### Bug Fixes

* **ci:** build frontend on the native platform to avoid QEMU arm64 hang ([c9e0633](https://github.com/ArnauFauquer/Realm-Keeper/commit/c9e0633bc90a7b0e30d299984fbbc2ba47a0b670))

## [0.1.77](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.76...v0.1.77) (2026-10-01)


### Features

* **dice:** Hope & Fear, advantage/disadvantage, criticals and roller fixes ([#15](https://github.com/ArnauFauquer/Realm-Keeper/issues/15)) ([18435ab](https://github.com/ArnauFauquer/Realm-Keeper/commit/18435ab9a4f832985fd7b07b1b935562a7aa48b9))
* **frontend:** design-token system and UI restructure, brand unchanged ([#13](https://github.com/ArnauFauquer/Realm-Keeper/issues/13)) ([f717905](https://github.com/ArnauFauquer/Realm-Keeper/commit/f717905ed65c9dc488324a4359b8e73260b9a61e))

## [0.1.76](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.75...v0.1.76) (2026-09-23)


### Bug Fixes

* **vistas:** handle raises the asset on screen instead of forcing depth ([eaa6d14](https://github.com/ArnauFauquer/Realm-Keeper/commit/eaa6d14c6f79b603ea901c4ac0e7dc46c7e23eca))

## [0.1.75](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.74...v0.1.75) (2026-09-23)


### Bug Fixes

* quote vista background url so asset keys with spaces render ([#9](https://github.com/ArnauFauquer/Realm-Keeper/issues/9)) ([a974b7f](https://github.com/ArnauFauquer/Realm-Keeper/commit/a974b7f83cff54b206158eb5dcc14da97ade6a70))

## [0.1.74](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.73...v0.1.74) (2026-09-23)


### Features

* pick chart maps, pin icons and vista backgrounds from the asset library ([#6](https://github.com/ArnauFauquer/Realm-Keeper/issues/6)) ([57efd3d](https://github.com/ArnauFauquer/Realm-Keeper/commit/57efd3d5fe9989de816a06dc18625fb21d460360))
* **vistas:** force asset depth order and cycle-select overlapped assets ([#8](https://github.com/ArnauFauquer/Realm-Keeper/issues/8)) ([cf76c27](https://github.com/ArnauFauquer/Realm-Keeper/commit/cf76c2743121f2016d9b181324418ac131dd29c5))

## [0.1.73](https://github.com/ArnauFauquer/Realm-Keeper/compare/v0.1.72...v0.1.73) (2026-09-22)


### Features

* show the app version next to the sidebar title ([#4](https://github.com/ArnauFauquer/Realm-Keeper/issues/4)) ([e2ce678](https://github.com/ArnauFauquer/Realm-Keeper/commit/e2ce6780bc3c604885ef28515ef667c8e0d979b3))
