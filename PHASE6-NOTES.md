# Phase 6 — Test-suite hardening — Notes

Status against the three roadmap items:

| # | Item | Status |
|---|---|---|
| 1 | Driver-parity regression test | Done — `test/test-driver-parity.js` |
| 2 | Keep the login→dashboard assertions in test-p1.js | No action needed — still there, untouched |
| 3 | CI workflow (`npm test` on push/PR) | Done — `.github/workflows/test.yml` |

## Item 1 — driver-parity test

`js/api.js` ships two drivers (`mock` and `http`) behind one interface,
`GOC.api`, which forwards every call as `return active.foo();` with nothing
checking at load time that `foo` exists on both sides. A method added to
one driver and not the other only surfaces later, as a runtime crash, on
whichever driver happens to be active when a user reaches that screen —
this is the exact bug class the original Phase 1.1 bug was.

`test/test-driver-parity.js` catches this automatically now. It loads the
real `js/api.js` in a `vm` sandbox (same pattern `test-p1.js` /
`test-math.js` already use) and reaches into both driver objects through a
new test-only hook, `GOC.api._drivers = { mock: mock, http: http }`, added
right after the `GOC.api` object literal in `js/api.js`. That's the only
production-code change this item required — two object references, never
read by `app.js` or `index.html`, so it changes nothing about how the app
behaves. The suite then asserts:

- every public method (no leading underscore — that's the escape hatch for
  a driver-private test helper like http's `_setPasscodeLength`) on one
  driver has a same-named method on the other, in both directions;
- every `active.foo(...)` call `GOC.api` itself forwards resolves on both
  drivers, parsed straight out of `js/api.js`'s own source rather than by
  invoking each method (many need a live session or real arguments, which
  would make this suite expensive and flaky for no extra safety).

Run today against the current codebase: **no parity gap exists** — 59
public methods on each side, matching names both ways. The one asymmetric
name (http's `_setPasscodeLength`) is intentionally private and excluded.
So this suite currently passes clean; its value is as a tripwire for the
*next* time someone adds a method to one driver and forgets the other, not
as evidence a gap exists now.

Registered in `test/run.js` as the 15th suite. Full local run: **15/15
green** (the original 14 plus this one), confirmed via the same
network-less busboy-stub trick documented in the Phase 2→3 handoff — stub
created, `node test/run.js` run, stub deleted immediately after. No test
file touches the upload/multipart routes, same as last time, so the stub
never needed to do real parsing.

## Item 3 — CI workflow

`.github/workflows/test.yml`: checks out the repo, sets up Node 18
(matching `package.json`'s `engines` field — keep these in sync if that
ever changes), runs `npm ci`, then `npm test` (`node test/run.js`) on every
push and pull request.

Also added a non-blocking `npm audit` step in the same job. This is the
first environment in this project's history with real npm registry
access, so it's the first time item #9 from the Phase 2 roadmap (`npm
audit` "was never actually run") can actually execute. It's
`continue-on-error: true` on purpose — the roadmap item asks for a human
to look at the output and decide, not for CI to silently gate merges on a
severity threshold nobody has agreed on yet. First real CI run is the
moment to have that conversation; the workflow file has a comment marking
where to remove `continue-on-error` once a policy exists.

## What Phase 6 did NOT touch

Nothing in Phases 3, 4, 5, 7, or 8. Those are unaffected by this work and
still stand exactly as the Phase 3-8 handoff described them.
