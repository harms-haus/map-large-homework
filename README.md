# File Browser

A full-stack file browser with a .NET Web API backend and a TypeScript SPA frontend.

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js v20+](https://nodejs.org/)
- npm (ships with Node.js)

## Quick Start

Run the following commands in order from the repository root.

```bash
# 1. Install JavaScript dependencies
npm install

# 2. Build the frontend
#    Compiles TypeScript in src/ to wwwroot/dist/ and copies src/app.css to wwwroot/dist/app.css
npm run build

# 3. Start the backend server
dotnet run --project TestProject.csproj
```

Open the HTTPS URL printed in the console (e.g. `https://localhost:7146`). Click **Browse Files** to open the file-browser dialog.

## Configuration

The server's home directory (where files are stored) is configurable via the `FileService:HomeDirectory` setting.

- **appsettings.json**: set `FileService.HomeDirectory` (default is `"Home"`).
- **Environment variable**: set `FileService__HomeDirectory` (double underscore).

Relative paths resolve under the app content root. The folder is created automatically on first use (lazily, the first time a file-system operation targets it), so a misconfigured path surfaces on the first request rather than at startup.

## Limits

- **Search results are capped at 500.** Search stops collecting matches once it reaches 500 results, so a broad query may return fewer entries than actually exist. Narrow the query or scope it to a subfolder to see additional matches.
- **Directory copy is limited to 32 levels of nesting.** Copying a tree nested more than 32 levels deep aborts with an IOException whose message is `Directory copy depth limit exceeded (possible cycle)`, to guard against stack overflow on pathological or self-referential directory trees.

## File name handling

Uploaded file names are sanitized before they touch disk, and the rules are enforced identically on every platform so an upload that works on Linux is also valid on Windows:

- **Directory components are stripped.** A submitted name like `../x` or `..\x` is reduced to its final segment (`x`), so an upload can never traverse out of its target directory. Both `/` and `\` are treated as separators.
- **Windows-incompatible names are rejected** with a `400 Bad Request`: names containing characters invalid on Windows (`< > : " | ? * \ /`) or matching a reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without an extension).

## Symlinks and junctions

Search and copy never follow symbolic links (Linux/macOS) or directory junctions (Windows). A link is still listed by name in browse and search results, but its contents are never scanned or copied, so a link that targets a location outside the home directory cannot leak external files into a search or copy.

## Search

Search is instant and debounced. As you type in the search box, a query fires ~200 ms after you stop typing — no separate Search button to click. Enter submits the current query immediately. Escape clears the query and returns to browse. When the input has text, a clear (✕) button appears inside it; click it (or clear the input) to reset the query. While a search request is in flight, a spinner is shown in the results area.

## Deep Linking

The app keeps its current view and location in the URL hash, so any folder listing or search result can be bookmarked or shared as a direct link.

- `#/browse` — root folder listing.
- `#/browse/Documents/Reports` — a nested folder.
- `#/search?q=budget&path=Documents` — a search scoped to a folder.

Each path segment is percent-encoded (e.g. spaces become `%20`).

## Running Tests

```bash
# Frontend tests (Vitest)
npm test

# Backend tests (xUnit)
dotnet test TestProject.Tests/TestProject.Tests.csproj
```

## Final End-to-End Verification Checklist

1. **`dotnet build TestProject.csproj`** — project compiles without errors.
2. **`npm test`** — all frontend tests pass.
3. **`npm run build`** — succeeds and produces `wwwroot/dist/app.js` and `wwwroot/dist/app.css`.
4. **`dotnet run`** — serves `index.html` at `/` (visit `https://localhost:7146`).
5. **`GET /api/files/browse?path=`** — returns JSON with `entries`, `folderCount`, `fileCount`, and `totalSize`.
6. **UI dialog** — opens when "Browse Files" is clicked.
7. **UI lists files/folders** — entries render in the table with Name, Size, Modified, and Actions columns.
8. **Upload** — file upload works via the Upload button.
9. **Download** — clicking the Download link retrieves the file.
10. **Delete** — Delete action removes files/folders after confirmation.
11. **Move** — Move action renames/relocates entries via a prompt.
12. **Copy** — Copy action duplicates entries via a prompt.
13. **Search** — The search input filters entries recursively by name with instant, debounced (200 ms) search-as-you-type; pressing Enter submits immediately, pressing Escape clears the query and returns to browse, the in-input ✕ clear button resets the query, and a spinner shows in the results area while a search fetch is in flight.
