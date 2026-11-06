# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `HistoryRegisteredCollection.startBatch` takes an optional `onCommit` callback, called once the batch is committed and unregistered. It lets other consumers end work they started alongside the batch.

### Fixed

- Undoing or redoing an update writes only the columns that the step changed. It wrote every column of the item, which took back what others had written to the rest of it since.
- Undoing a removal or redoing an insert leaves an item that is there already as it is, instead of throwing and leaving the step half done.
