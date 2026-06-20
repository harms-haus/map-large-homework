using System;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests;

/// <summary>
/// Documentation-accuracy tests for <c>README.md</c>.
///
/// <para>
/// The <c>FileService</c> home directory is created <b>lazily</b>: directory
/// creation is wrapped in a <c>Lazy&lt;string&gt;</c> (<c>_rootLazy</c>) that
/// is materialized only on the first access of the <c>Root</c> property — i.e.
/// on the first file-system operation, not at construction or DI resolution.
/// The behavioral contract is pinned down by
/// <see cref="Services.FileServiceTests.Constructor_DoesNotCreateRootDirectory_BeforeFirstUse"/>
/// and its siblings (the directory must NOT exist after construction, and a
/// misconfigured path must surface on first use rather than at startup).
/// </para>
///
/// <para>
/// These tests guard the corresponding sentence in the README's
/// <c>## Configuration</c> section so the prose cannot drift back to the
/// pre-refactor claim that the folder is "created automatically on startup"
/// (which described the legacy eager <c>Directory.CreateDirectory(root)</c>
/// call in the constructor). They parse <c>README.md</c> directly, mirroring
/// the source-parsing approach used by <see cref="ProgramWiringTests"/>.
/// </para>
/// </summary>
public class ReadmeDocumentationTests
{
    private static readonly string ReadmeSource =
        SourceFileLoader.LoadAdjacent("README.md");

    /// <summary>
    /// The README must describe the home-directory folder as being created on
    /// first use (lazily), matching the <c>FileService</c> implementation.
    /// Asserting the key phrases "first use" and "lazily" keeps the test
    /// resilient to minor rephrasing while still failing if the wording
    /// regresses to eager/startup creation.
    /// </summary>
    [Fact]
    public void Readme_ConfigurationSection_DescribesLazyFolderCreation()
    {
        Assert.Contains("first use", ReadmeSource, StringComparison.Ordinal);
        Assert.Contains("lazily", ReadmeSource, StringComparison.Ordinal);
    }

    /// <summary>
    /// The README must explain the observable consequence of lazy creation —
    /// that a misconfigured path surfaces on the first request rather than at
    /// startup. This is the user-facing behavior the
    /// <c>Constructor_MisconfiguredHomeDirectory_DoesNotThrowUntilFirstUse</c>
    /// test proves at the code level, and the documentation must match it.
    /// </summary>
    [Fact]
    public void Readme_ConfigurationSection_StatesMisconfigurationSurfacesOnFirstRequest()
    {
        Assert.Contains("first request", ReadmeSource, StringComparison.Ordinal);
        Assert.Contains("rather than at startup", ReadmeSource, StringComparison.Ordinal);
    }

    /// <summary>
    /// The pre-refactor claim that the folder is "created automatically on
    /// startup" must be gone from the README. That wording described the old
    /// eager constructor call and is now inaccurate; leaving it in would
    /// mislead users about when misconfiguration or disk errors surface. This
    /// test fails the moment the stale sentence is reintroduced.
    /// </summary>
    [Fact]
    public void Readme_ConfigurationSection_DoesNotClaimCreationOnStartup()
    {
        Assert.DoesNotContain("created automatically on startup", ReadmeSource, StringComparison.Ordinal);
    }

    // =====================================================================
    // Limits section — behavioral limits enforced by FileService
    //
    // FileService enforces two user-visible limits whose observable effects
    // (truncated search output and copy failures on deeply nested trees) a
    // user cannot otherwise explain from the docs:
    //   - MaxSearchResults == 500: Search stops collecting once it reaches
    //     500 matches. Pinned by FileServiceTests.Search_CapsResultsAtFiveHundred.
    //   - MaxCopyDepth == 32: CopyDirectory aborts with IOException once
    //     recursion reaches 32 levels. Pinned by FileServiceTests
    //     Copy_DirectoryChain_WithinDepthLimit_CopiesCompletely and
    //     Copy_DirectoryChain_AtOrBeyondDepthLimit_ThrowsIOException.
    // The README must dedicate a ## Limits section to both. The tests below
    // are documentation-accuracy specs: they FAIL until that section exists
    // with the required content and then guard it against drift.
    // =====================================================================

    /// <summary>
    /// Extracts the body of the README's <c>## Limits</c> section — the text
    /// starting at the <c>## Limits</c> heading up to (but not including) the
    /// next level-2 (<c>## </c>) heading. Returns an empty string when the
    /// section is absent, so the assertion tests below fail with a clear
    /// expected/actual message rather than an index exception.
    /// </summary>
    private static string LimitsSection()
    {
        var start = ReadmeSource.IndexOf("\n## Limits", StringComparison.Ordinal);
        if (start < 0)
        {
            return "";
        }

        // Skip past the heading line, then find the next level-2 heading so
        // assertions are scoped to the Limits section rather than the whole
        // document (avoids matching a stray "500" or "32" elsewhere).
        var headingEnd = ReadmeSource.IndexOf('\n', start + 1);
        if (headingEnd < 0)
        {
            return ReadmeSource.Substring(start);
        }

        var nextHeading = ReadmeSource.IndexOf("\n## ", headingEnd + 1, StringComparison.Ordinal);
        return nextHeading < 0
            ? ReadmeSource.Substring(start)
            : ReadmeSource.Substring(start, nextHeading - start);
    }

    /// <summary>
    /// Returns the first markdown bullet line (starting with <c>-</c> or
    /// <c>*</c>) within <paramref name="section"/> that contains
    /// <paramref name="needle"/> (case-insensitive), or <c>null</c> when no
    /// such bullet exists. Used to scope assertions to the search vs. copy
    /// bullet individually so the two limits cannot be silently transposed.
    /// </summary>
    private static string? FirstBulletContaining(string section, string needle)
    {
        foreach (var line in section.Split('\n'))
        {
            var trimmed = line.TrimStart();
            if ((trimmed.StartsWith('-') || trimmed.StartsWith('*')) &&
                line.Contains(needle, StringComparison.OrdinalIgnoreCase))
            {
                return line;
            }
        }

        return null;
    }

    /// <summary>
    /// The README must include a level-2 <c>## Limits</c> heading. Without a
    /// dedicated section the 500-result search cap and the 32-level copy
    /// depth limit go undocumented, leaving users unable to explain truncated
    /// search output or copy failures on deep directory trees.
    /// </summary>
    [Fact]
    public void Readme_LimitsSection_Exists()
    {
        Assert.Contains("\n## Limits", ReadmeSource, StringComparison.Ordinal);
    }

    /// <summary>
    /// The <c>## Limits</c> section must be placed immediately after the
    /// Configuration section (which ends with the lazy-creation sentence
    /// ending "rather than at startup.") and before the <c>## Deep Linking</c>
    /// section. Positioning the limits adjacent to the behavior they constrain
    /// keeps them discoverable and matches the fix specification.
    /// </summary>
    [Fact]
    public void Readme_LimitsSection_IsPlacedBetween_Configuration_And_DeepLinking()
    {
        var configurationTail = ReadmeSource.IndexOf("rather than at startup", StringComparison.Ordinal);
        var limits = ReadmeSource.IndexOf("\n## Limits", StringComparison.Ordinal);
        var deepLinking = ReadmeSource.IndexOf("\n## Deep Linking", StringComparison.Ordinal);

        Assert.True(configurationTail >= 0,
            "Expected the Configuration section's trailing 'rather than at startup' sentence.");
        Assert.True(limits >= 0, "Expected a '## Limits' section in README.md.");
        Assert.True(deepLinking >= 0, "Expected a '## Deep Linking' section in README.md.");

        Assert.True(configurationTail < limits,
            "The '## Limits' section must come after the Configuration section.");
        Assert.True(limits < deepLinking,
            "The '## Limits' section must come before the '## Deep Linking' section.");
    }

    /// <summary>
    /// The search bullet must document the 500-result cap (matching
    /// <c>FileService.MaxSearchResults</c>), explain the observable
    /// consequence — that a broad query may return fewer entries than
    /// actually exist — and offer at least one remedy (narrowing the query or
    /// scoping it to a subfolder). Scoping assertions to the search bullet
    /// prevents the 500 from being attached to the wrong limit.
    /// </summary>
    [Fact]
    public void Readme_LimitsSection_SearchBullet_DocumentsCap_Consequence_AndRemedy()
    {
        var section = LimitsSection();
        var searchBullet = FirstBulletContaining(section, "search");

        Assert.True(searchBullet is not null,
            "Expected a Limits bullet describing search.");

        Assert.Contains("500", searchBullet!, StringComparison.Ordinal);
        Assert.Contains("fewer", searchBullet, StringComparison.OrdinalIgnoreCase);

        var suggestsNarrowing = searchBullet.Contains("narrow", StringComparison.OrdinalIgnoreCase);
        var suggestsScoping =
            searchBullet.Contains("scope", StringComparison.OrdinalIgnoreCase) ||
            searchBullet.Contains("subfolder", StringComparison.OrdinalIgnoreCase);
        Assert.True(suggestsNarrowing || suggestsScoping,
            "The search-limit bullet should suggest narrowing the query or scoping it to a subfolder.");
    }

    /// <summary>
    /// The copy bullet must document the 32-level directory copy depth limit
    /// (matching <c>FileService.MaxCopyDepth</c>), quote the exact
    /// <see cref="IOException"/> message thrown at the boundary, and explain
    /// the rationale (guarding against stack overflow). The exception message
    /// is asserted verbatim because a user hitting the error must be able to
    /// recognize it in the docs.
    /// </summary>
    [Fact]
    public void Readme_LimitsSection_CopyBullet_DocumentsDepthLimit_Message_AndRationale()
    {
        var section = LimitsSection();
        var copyBullet = FirstBulletContaining(section, "copy");

        Assert.True(copyBullet is not null,
            "Expected a Limits bullet describing copy.");

        Assert.Contains("32", copyBullet!, StringComparison.Ordinal);
        Assert.True(
            copyBullet.Contains("level", StringComparison.OrdinalIgnoreCase) ||
            copyBullet.Contains("nest", StringComparison.OrdinalIgnoreCase),
            "The copy-limit bullet should describe the limit in terms of levels / nesting depth.");

        // The exact exception text thrown by FileService.CopyDirectory.
        Assert.Contains(
            "Directory copy depth limit exceeded (possible cycle)",
            copyBullet,
            StringComparison.Ordinal);

        Assert.Contains("stack overflow", copyBullet, StringComparison.OrdinalIgnoreCase);
    }
}
