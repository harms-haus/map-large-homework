using TestProject.Models;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Models;

/// <summary>
/// Characterization tests for <see cref="SearchResultDto"/>.
///
/// <para>
/// These pin the record's observable contract so that the split of
/// <c>Models/FileSystemModels.cs</c> into per-DTO files is provably
/// behavior-preserving: the type stays a sealed record in
/// <c>TestProject.Models</c>, its positional constructor keeps the exact
/// parameter names/types/order
/// <c>(Query, Path, Results)</c> — including the
/// <c>IReadOnlyList&lt;FileEntryDto&gt;</c> shape of <c>Results</c> — and its
/// record semantics (value equality, reference-based collection comparison,
/// <c>with</c>, deconstruction) are unchanged regardless of which file
/// declares it.
/// </para>
/// </summary>
public class SearchResultDtoTests
{
    private static FileEntryDto Entry(string name) =>
        new(name, "docs/" + name, false, 1L, new DateTime(2024, 1, 1), 0);

    private static SearchResultDto Create() =>
        new("report", "docs", new[] { Entry("report.txt") });

    // =====================================================================
    // Type contract: sealed record in the Models namespace
    // =====================================================================

    [Fact]
    public void IsSealedRecordInTestProjectModelsNamespace()
    {
        RecordContract.AssertSealedRecordInNamespace(
            typeof(SearchResultDto), "TestProject.Models");
    }

    [Fact]
    public void Constructor_ExposesExactPositionalSignature()
    {
        RecordContract.AssertPositionalContract(
            typeof(SearchResultDto),
            (nameof(SearchResultDto.Query), typeof(string)),
            (nameof(SearchResultDto.Path), typeof(string)),
            (nameof(SearchResultDto.Results), typeof(IReadOnlyList<FileEntryDto>)));
    }

    [Fact]
    public void Constructor_AssignsEachArgumentToItsProperty()
    {
        var results = new[] { Entry("a.txt"), Entry("b.txt") };
        var dto = new SearchResultDto("report", "docs", results);

        Assert.Equal("report", dto.Query);
        Assert.Equal("docs", dto.Path);
        Assert.Same(results, dto.Results);
        Assert.Equal(new[] { Entry("a.txt"), Entry("b.txt") }, dto.Results);
    }

    // =====================================================================
    // Value equality (record semantics)
    // =====================================================================

    [Fact]
    public void Equals_True_WhenAllFieldsMatchAndResultsShareReference()
    {
        var shared = new[] { Entry("report.txt") };
        var a = new SearchResultDto("report", "docs", shared);
        var b = new SearchResultDto("report", "docs", shared);

        RecordContract.AssertEquality(a, b, expectedEqual: true);
    }

    [Theory]
    [InlineData("other", "docs")]   // Query differs
    [InlineData("report", "other")] // Path differs
    public void Equals_False_WhenAnyScalarFieldDiffers(string query, string path)
    {
        var shared = new[] { Entry("report.txt") };
        var a = new SearchResultDto("report", "docs", shared);
        var b = new SearchResultDto(query, path, shared);

        RecordContract.AssertEquality(a, b, expectedEqual: false);
    }

    [Fact]
    public void Equals_False_WhenResultsAreDifferentInstances_EvenWithIdenticalContent()
    {
        // Records compare collection members by reference (no built-in
        // sequence equality), so two distinct list instances with identical
        // contents must be NOT equal. Pinned so the move to a new file does
        // not accidentally introduce sequence-based comparison.
        var a = new SearchResultDto("report", "docs", new[] { Entry("report.txt") });
        var b = new SearchResultDto("report", "docs", new[] { Entry("report.txt") });

        Assert.NotEqual(a, b);
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
        var shared = new[] { Entry("report.txt") };
        var a = new SearchResultDto("report", "docs", shared);
        var b = new SearchResultDto("report", "docs", shared);

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

        var copy = original with { Query = "other" };

        Assert.NotSame(original, copy);
        Assert.Equal("other", copy.Query);
        Assert.Equal(original.Path, copy.Path);
        Assert.Same(original.Results, copy.Results);
        Assert.False(copy.Equals(original));
    }

    // =====================================================================
    // Deconstruction (positional record)
    // =====================================================================

    [Fact]
    public void Deconstruct_ReturnsConstructorArgumentsInOrder()
    {
        var dto = Create();

        var (query, path, results) = dto;

        Assert.Equal(dto.Query, query);
        Assert.Equal(dto.Path, path);
        Assert.Same(dto.Results, results);
    }

    // =====================================================================
    // Synthesized ToString
    // =====================================================================

    [Fact]
    public void ToString_IncludesTypeNameAndQuery()
    {
        var dto = Create();

        var text = dto.ToString();

        Assert.Contains("SearchResultDto", text);
        Assert.Contains("report", text);
    }
}
