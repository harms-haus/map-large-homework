Development Diary

1. Ran the Engin harness orchestrator (my own: https://github.com/harms-haus/engin, it uses pi-coding-agent with my own extensions to perform scouting, planning, parallel task implementation, and review) with the "develop" workflow to generate a base to start with.
2. Human Review: Fixed a few issues. Added icon pack (bootstrap). Cleaned up the dialog styling. Added an embedded mode so that the file browser appears in the browser's main page. The button remains and continues to open a dialog version. Added a sample set of files to browse around in.
3. Ran the Engin harness orchestrator with the "improve" workflow to clean up the codebase.
4. Human Review: Found four distinct issues with the file service: Delete is broken on Windows (I use Arch btw); Upload doesn't check safe destination path; Windows control chars aren't caught by invalid chars; Symlinks allow escaping the sandbox.
5. Added CI/CD: GitHub Actions workflow. Switched to oxlint (faaast). Added prettier. Fixed prettier, linting, and test errors.
6. Added context menu and moved the action buttons into a drop-down menu using Engin.
7. Cleaned up the context menu, adding an upload action and new directory action. Fixed the menu clamping onscreen. Added icons to the menu items.
8. Replaced the search button with icon buttons and instant-search. Search results are now also streamed from the server, with a loading spinner until the stream completes.
9. Human review found minor issues after the search bar revamp.
10. Ran the Engin harness orchestrator with the "improve" workflow to clean up the codebase.
11. Human Review: Clean up useless tests, verbose comments, shorthand goop, corrected error codes.
12. Added wildcards for search
13. Added dedicated dialogs for delete confirmation, moving files, etc.
