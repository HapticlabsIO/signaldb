---
layout: home

title: SignalDB
titleTemplate: reactive local javascript database

head:
- - link
  - rel: canonical
    href: https://signaldb.js.org/
- - meta
  - name: og:type
    content: website
- - meta
  - name: og:url
    content: https://signaldb.js.org/
- - meta
  - name: og:title
    content: SignalDB - Reactive Local-First JavaScript Database
- - meta
  - name: og:description
    content: SignalDB is a reactive, local-first JavaScript database with Optimistic UI, signal-based reactivity and a built-in undo/redo history.
- - meta
  - name: description
    content: SignalDB is a reactive, local-first JavaScript database with Optimistic UI, signal-based reactivity and a built-in undo/redo history
- - meta
  - name: keywords
    content: signaldb, local first, live updates, MongoDB-like, reactive, JavaScript, TypeScript, database, optimistic UI, framework agnostic, signals, schema-less, undo redo, history

hero:
  name: SignalDB
  text: Reactive Local-First JavaScript Database
  tagline: Signals for instant UI updates, with a built-in undo/redo history.
  image:
    src: /logo.svg
    alt: SignalDB Logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/maxnowack/signaldb

features:
  - icon: ⚡️
    title: Signal-Based Reactivity
    link: /reactivity/
    details: SignalDB is a <strong>reactive JavaScript database</strong> powered by signals for instant UI updates. Bring your own reactivity library via <a href="/reference/core/createreactivityadapter/">createReactivityAdapter</a>.
  - icon: 👌
    title: Developer Friendly
    link: /core-concepts/
    details: Full <strong>TypeScript</strong> support with a familiar <a href="/queries/">MongoDB-like query</a> API. Model relationships easily with the built-in <a href="/orm/">ORM</a>.
  - icon: ✨
    title: Optimistic UI
    link: /core-concepts/#optimistic-ui
    details: Ship snappy apps with <strong>optimistic UI</strong>—updates render instantly, then get confirmed or rolled back.
  - icon: ⏪
    title: History &amp; Undo/Redo
    link: /reference/core/collection/
    details: Track changes to a collection and <strong>undo or redo</strong> them, individually or batched together.
  - icon: 💾
    title: Storage Adapters
    link: /data-persistence/
    details: Persist data anywhere with flexible <strong>storage adapters</strong>. Implement your own via <a href="/reference/core/createpersistenceadapter/">createPersistenceAdapter</a>.
---
