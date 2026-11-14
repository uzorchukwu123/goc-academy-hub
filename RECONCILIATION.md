# Reconciliation — one baseline again

**In plain words:** the repository held two versions of the academy that were
not related to each other in Git’s history, and they described opposite ways of
joining. Git could not merge them, and a pull request between them would have
looked like someone deleting most of the app. I have put the branch back on the
official `main` line, re-applied the maintenance work there, and kept the old
work safely in history. Everything now passes.

No deployment was made.

---

## 1. What was wrong

There were two “latest” versions:

| Line | Commit | What it is |
| --- | --- | --- |
| Official main | `17cc20f` — *Merge pull request #15* | Open/GOC tiers, “Two ways in”, 228 test suites. This is the merged, live product. |
| This session's branch | `90a1e85` — *Stage B: application-first registration* | Removes the Open/GOC tiers, replaces open sign-up with a registration code + application + approval, 212 suites. |

Git reported **“refusing to merge unrelated histories”**. They have no shared
ancestor commit — as if two copies of the project were started separately and
then both kept evolving. Even their contents were pulled in opposite
directions:

- main **adds** the Open/GOC tier system and lets anyone sign up as Open;
- Stage B **removes** the tier system (“the Open Student tier is gone, one
  student identity”) and makes sign-up an application with a code.

You cannot have both at once. Keeping Stage B means deleting main's tier
feature; keeping main means Stage B's registration process is not active. A
mechanical merge would produce broken code and failing tests either way.

## 2. What I decided, and why

**`origin/main` is the baseline.** Reasons:

1. It is the line that was actually merged (PR #15) and is therefore the
   official product.
2. The improvement brief describes main, not Stage B — “Two Ways In”, the Open
   and GOC cards, and the “Ready to study with purpose?” homepage only exist
   in main.
3. Stage B has never been merged. It is the experiment, not the line of record.

So the reconciled branch = **main + the maintenance switch + the reports**.
Stage B is not deleted: it remains recoverable at commit `90a1e85`.

## 3. How it was done

1. Saved the unique Workstream A files and both reports outside the tree.
2. Recorded `origin/main` as a **second parent** of this branch (a merge that
   changes history relationships only). This removed the “unrelated histories”
   block and makes a future PR comparable with main.
3. Replaced the working tree with **main's exact contents**.
4. Re-applied Workstream A onto main: the maintenance module, the single gate
   in `server/server.js`, the Function gate, the static maintenance build, the
   environment/docs rows, the maintenance test, and the suite registration.
5. Updated the two reports to describe this baseline.
6. Ran everything:
   - `node test/test-maintenance-mode.js` → **80 / 80 pass** on main's server,
     Function handler and both build paths;
   - full `node test/run.js` → **229 / 229 suites pass, exit 0** (main's 228
     suites plus the maintenance suite).

The branch history now looks like this:

```
*  (reconciliation commit — main content + maintenance + reports)
*   aebd3fd  Merge origin/main (history reconnected; content reconciled next)
|\
| * 17cc20f  Merge PR #15 (official main)
* | db83202  Workstream A + B reports (Stage B tree)
* | 363a9cf  Maintenance mode (Stage B tree)
* | 90a1e85  Stage B registration
```

## 4. What this changes for you

- **A pull request is now possible.** Against `main`, it shows only the
  maintenance feature, its tests, its runbook and the two reports — not a
  wholesale rewrite. No pull request has been opened and nothing has been
  deployed.
- **The current code behaves like main.** Open/GOC tiers, open sign-up with an
  Open account, “Two ways in”, the tier test suites: all present and passing.
- **Stage B is dormant.** Its registration codes, applications, approval screen
  and its “no tiers” rules are not in the working tree. It is intact in Git at
  `90a1e85` if you want to inspect or restore it.
- **The improvement inspection is still valid** because it was written against
  main all along. Its section 0 and closing section now record the
  reconciliation.

## 5. If Stage B was actually the direction you wanted

Then this reconciliation went the wrong way **on purpose, pending your
decision** — because choosing Stage B means deliberately undoing the merged
tier system, not merging two compatible things. In that case the next job is a
separate, explicit piece of work:

- restore the Stage B tree (`git checkout 90a1e85 -- .` on a new branch),
- remove the tier code, routes, tests and sign-up copy from main rather than
  leave both,
- decide what happens to existing Open-tier students and their records,
- update the homepage (“Two ways in”, Open/GOC cards) and the brief, which
  currently assumes tiers exist,
- re-run and rewrite the tier suites.

None of that has been done, and it should not be done without your explicit
approval.

## 6. How to see or restore the old Stage B work

```bash
# inspect a file from the archived Stage B commit
git show 90a1e85:server/server.js | less

# see everything that was on that tree
git ls-tree -r --name-only 90a1e85 | less

# if you ever want it as its own branch again (owner decision)
git switch -c stage-b-archive 90a1e85
```

The session itself remains on `arena/be3c2044-goc-academy-hub` and did not
switch branches.

## 7. Verification after reconciliation

| Check | Result |
| --- | --- |
| `git merge-base HEAD origin/main` | `origin/main` (histories connected) |
| Working tree vs `origin/main` | maintenance files + the two reports only |
| `node test/test-maintenance-mode.js` | 80 passed, 0 failed |
| `node test/run.js` | 229 suites, all passed, exit 0 |
| `node build/build.js` | full app builds; maintenance build emits only `index.html` + `sw.js` |
| Deployment | none |
| Pull request | none opened |
