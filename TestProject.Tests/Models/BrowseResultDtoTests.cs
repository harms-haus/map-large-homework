using TestProject.Models;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Models;

/// <summary>
/// Characterization tests for <see cref="BrowseResultDto"/>.
///
/// <para>
/// These pin the record's observable contract so that the split of
/// <c>Models/FileSystemModels.cs</c> into per-DTO files is provably
/// behavior-preserving: the type stays a sealed record in
/// <c>TestProject.Models</c>, its positional constructor keeps the exact
/// parameter names/types/order
/// <c>(Path, Parent, Entries, FolderCount, FileCount, TotalSize)</c> — including
/// the <c>IReadOnlyList&lt;FileEntryDto&gt;</c> shape of <c>Entries</c> and the
/// nullable <c>string?</c> shape of <c>Parent</c> — and its record semantics
/// (value equality, reference-based collection comparison, <c>with</c>,
/// deconstruction) are unchanged regardless of which file declares it.
/// </para>
/// </summary>
public class BrowseResultDtoTests
{
    private static FileEntryDto Entry(string name) =>
        new(name, "docs/" + name, false, 1L, new DateTime(2024, 1, 1), 0);

    private static BrowseResultDto Create() =>
        new("docs", "home", new[] { Entry("a.txt") }, 0, 1, 1L);

    // =====================================================================
    // Type contract: sealed record in the Models namespace
    // =====================================================================

    [Fact]
    public void IsSealedRecordInTestProjectModelsNamespace()
    {
        RecordContract.AssertSealedRecordInNamespace(
            typeof(BrowseResultDto), "TestProject.Models");
    }

    [Fact]
    public void Constructor_ExposesExactPositionalSignature()
    {
        RecordContract.AssertPositionalContract(
            typeof(BrowseResultDto),
            (nameof(BrowseResultDto.Path), typeof(string)),
            (nameof(BrowseResultDto.Parent), typeof(string)),
            (nameof(BrowseResultDto.Entries), typeof(IReadOnlyList<FileEntryDto>)),
            (nameof(BrowseResultDto.FolderCount), typeof(int)),
            (nameof(BrowseResultDto.FileCount), typeof(int)),
            (nameof(BrowseResultDto.TotalSize), typeof(long)));
    }

    [Fact]
    public void Constructor_AssignsEachArgumentToItsProperty()
    {
        var entries = new[] { Entry("a.txt"), Entry("b.txt") };
        var dto = new BrowseResultDto("docs", "home", entries, 2, 3, 30L);

        Assert.Equal("docs", dto.Path);
        Assert.Equal("home", dto.Parent);
        Assert.Same(entries, dto.Entries);
        Assert.Equal(new[] { Entry("a.txt"), Entry("b.txt") }, dto.Entries);
        Assert.Equal(2, dto.FolderCount);
        Assert.Equal(3, dto.FileCount);
        Assert.Equal(30L, dto.TotalSize);
    }

    [Fact]
    public void Constructor_AcceptsNullParent()
    {
        var dto = new BrowseResultDto("docs", null, Array.Empty<FileEntryDto>(), 0, 0, 0L);

        Assert.Null(dto.Parent);
    }

    // =====================================================================
    // Value equality (record semantics)
    // =====================================================================

    [Fact]
    public void Equals_True_WhenAllFieldsMatchAndEntriesShareReference()
    {
        var sharedEntries = new[] { Entry("a.txt") };
        var a = new BrowseResultDto("docs", "home", sharedEntries, 0, 1, 1L);
        var b = new BrowseResultDto("docs", "home", sharedEntries, 0, 1, 1L);

        RecordContract.AssertEquality(a, b, expectedEqual: true);
    }

    [Theory]
    [InlineData("other", "home", 0, 1, 1L)]    // Path differs
    [InlineData("docs", "root", 0, 1, 1L)]     // Parent differs
    [InlineData("docs", "home", 9, 1, 1L)]     // FolderCount differs
    [InlineData("docs", "home", 0, 9, 1L)]     // FileCount differs
    [InlineData("docs", "home", 0, 1, 99L)]    // TotalSize differs
    public void Equals_False_WhenAnyScalarFieldDiffers(
        string path, string parent, int folderCount, int fileCount, long totalSize)
    {
        var sharedEntries = new[] { Entry("a.txt") };
        var a = new BrowseResultDto("docs", "home", sharedEntries, 0, 1, 1L);
        var b = new BrowseResultDto(path, parent, sharedEntries, folderCount, fileCount, totalSize);

        RecordContract.AssertEquality(a, b, expectedEqual: false);
    }

    [Fact]
    public void Equals_False_WhenEntriesAreDifferentInstances_EvenWithIdenticalContent()
    {
        // Records compare collection members with
        // EqualityComparer<IReadOnlyList<FileEntryDto>>.Default, which is the
        // default object comparer (reference equality) — there is no built-in
        // sequence equality. Two structurally identical but distinct list
        // instances must therefore be NOT equal. Pinning this so the move to a
        // new file does not accidentally introduce sequence-based comparison.
        var a = new BrowseResultDto("docs", "home", new[] { Entry("a.txt") }, 0, 1, 1L);
        var b = new BrowseResultDto("docs", "home", new[] { Entry("a.txt") }, 0, 1, 1L);

        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Equals_False_WhenParentDiffersBetweenNullAndEmptyString()
    {
        // null and "" are distinct reference/equality values; a nullable
        // Parent must not collapse them.
        var withNull = new BrowseResultDto("docs", null, Array.Empty<FileEntryDto>(), 0, 0, 0L);
        var withEmpty = new BrowseResultDto("docs", "", Array.Empty<FileEntryDto>(), 0, 0, 0L);

        Assert.NotEqual(withNull, withEmpty);
    }

    [Fact]
    public void Equals_False_ForNull()
    {
        Assert.False(Create().Equals(null));
    }

    [Fact]
    public void Equals_True_ForSelfByReference()
    {
        var dto = Create();
        Assert.True(dto.Equals(dto));
        Assert.Same(dto, dto);
    }

    [Fact]
    public void EqualityOperators_AreValueBased()
    {
        var shared = new[] { Entry("a.txt") };
        var a = new BrowseResultDto("docs", "home", shared, 0, 1, 1L);
        var b = new BrowseResultDto("docs", "home", shared, 0, 1, 1L);

        Assert.True(a == b);
        Assert.False(a != b);
    }

    // =====================================================================
    // Non-mutating copy expression (init accessors)
    // =====================================================================

    [Fact]
    public void With_CopiesAllFieldsExceptTheTargetedOne()
    {
        var original = Create();

        var copy = original with { FolderCount = 5 };

        Assert.NotSame(original, copy);
        Assert.Equal(5, copy.FolderCount);
        Assert.Equal(original.Path, copy.Path);
        Assert.Equal(original.Parent, copy.Parent);
        Assert.Same(original.Entries, copy.Entries);
        Assert.Equal(original.FileCount, copy.FileCount);
        Assert.Equal(original.TotalSize, copy.TotalSize);
        Assert.False(copy.Equals(original));
    }

    // =====================================================================
    // Deconstruction (positional record)
    // =====================================================================

    [Fact]
    public void Deconstruct_ReturnsConstructorArgumentsInOrder()
    {
        var dto = Create();

        var (path, parent, entries, folderCount, fileCount, totalSize) = dto;

        Assert.Equal(dto.Path, path);
        Assert.Equal(dto.Parent, parent);
        Assert.Same(dto.Entries, entries);
        Assert.Equal(dto.FolderCount, folderCount);
        Assert.Equal(dto.FileCount, fileCount);
        Assert.Equal(dto.TotalSize, totalSize);
    }

    // =====================================================================
    // Synthesized ToString
    // =====================================================================

    [Fact]
    public void ToString_IncludesTypeNameAndPath()
    {
        var dto = Create();

        var text = dto.ToString();

        Assert.Contains("BrowseResultDto", text);
        Assert.Contains("docs", text);
    }
}
