using TestProject.Models;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Models;

/// <summary>
/// Characterization tests for <see cref="FileEntryDto"/>.
///
/// <para>
/// These pin the record's observable contract so that the split of
/// <c>Models/FileSystemModels.cs</c> into per-DTO files is provably
/// behavior-preserving: the type stays a sealed record in
/// <c>TestProject.Models</c>, its positional constructor keeps the exact
/// parameter names/types/order
/// <c>(Name, Path, IsDirectory, Size, LastModified, ItemCount)</c>, and its
/// record semantics (value equality, <c>with</c>, deconstruction, synthesized
/// <see cref="object.ToString"/>) are unchanged regardless of which file
/// declares it.
/// </para>
/// </summary>
public class FileEntryDtoTests
{
    private static readonly DateTime Stamp =
        new(2024, 1, 15, 10, 30, 0, DateTimeKind.Utc);

    private static FileEntryDto Create() =>
        new("report.txt", "docs/report.txt", false, 42L, Stamp, 0);

    // =====================================================================
    // Type contract: sealed record in the Models namespace
    // =====================================================================

    [Fact]
    public void IsSealedRecordInTestProjectModelsNamespace()
    {
        RecordContract.AssertSealedRecordInNamespace(
            typeof(FileEntryDto), "TestProject.Models");
    }

    [Fact]
    public void Constructor_ExposesExactPositionalSignature()
    {
        RecordContract.AssertPositionalContract(
            typeof(FileEntryDto),
            (nameof(FileEntryDto.Name), typeof(string)),
            (nameof(FileEntryDto.Path), typeof(string)),
            (nameof(FileEntryDto.IsDirectory), typeof(bool)),
            (nameof(FileEntryDto.Size), typeof(long)),
            (nameof(FileEntryDto.LastModified), typeof(DateTime)),
            (nameof(FileEntryDto.ItemCount), typeof(int)));
    }

    [Fact]
    public void Constructor_AssignsEachArgumentToItsProperty()
    {
        var dto = Create();

        Assert.Equal("report.txt", dto.Name);
        Assert.Equal("docs/report.txt", dto.Path);
        Assert.False(dto.IsDirectory);
        Assert.Equal(42L, dto.Size);
        Assert.Equal(Stamp, dto.LastModified);
        Assert.Equal(0, dto.ItemCount);
    }

    // =====================================================================
    // Value equality (record semantics)
    // =====================================================================

    [Fact]
    public void Equals_True_WhenAllFieldsMatch()
    {
        RecordContract.AssertEquality(Create(), Create(), expectedEqual: true);
    }

    [Theory]
    [InlineData("different.txt", "docs/report.txt", false, 42L, 0)]      // Name differs
    [InlineData("report.txt", "other/report.txt", false, 42L, 0)]        // Path differs
    [InlineData("report.txt", "docs/report.txt", true, 42L, 0)]          // IsDirectory differs
    [InlineData("report.txt", "docs/report.txt", false, 999L, 0)]        // Size differs
    [InlineData("report.txt", "docs/report.txt", false, 42L, 7)]         // ItemCount differs
    public void Equals_False_WhenAnyFieldDiffers(
        string name, string path, bool isDirectory, long size, int itemCount)
    {
        var a = Create();
        var b = new FileEntryDto(name, path, isDirectory, size, Stamp, itemCount);

        RecordContract.AssertEquality(a, b, expectedEqual: false);
    }

    [Fact]
    public void Equals_False_WhenLastModifiedDiffers()
    {
        var a = Create();
        var b = a with { LastModified = Stamp.AddSeconds(1) };

        RecordContract.AssertEquality(a, b, expectedEqual: false);
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
        var a = Create();
        var b = Create();

        Assert.True(a == b);
        Assert.False(a != b);
    }

    [Fact]
    public void EqualityOperators_DifferWhenFieldsDiffer()
    {
        Assert.True(Create() != Create() with { Name = "other" });
    }

    // =====================================================================
    // Non-mutating copy expression (init accessors)
    // =====================================================================

    [Fact]
    public void With_CopiesAllFieldsExceptTheTargetedOne()
    {
        var original = Create();

        var copy = original with { Size = 100L };

        Assert.NotSame(original, copy);
        Assert.Equal(100L, copy.Size);
        // Untouched fields are preserved verbatim.
        Assert.Equal(original.Name, copy.Name);
        Assert.Equal(original.Path, copy.Path);
        Assert.Equal(original.IsDirectory, copy.IsDirectory);
        Assert.Equal(original.LastModified, copy.LastModified);
        Assert.Equal(original.ItemCount, copy.ItemCount);
        Assert.False(copy.Equals(original));
    }

    [Fact]
    public void With_NoChanges_YieldsEqualButNotSameReference()
    {
        var original = Create();

        var copy = original with { };

        Assert.NotSame(original, copy);
        Assert.Equal(original, copy);
    }

    // =====================================================================
    // Deconstruction (positional record)
    // =====================================================================

    [Fact]
    public void Deconstruct_ReturnsConstructorArgumentsInOrder()
    {
        var dto = Create();

        var (name, path, isDirectory, size, lastModified, itemCount) = dto;

        Assert.Equal(dto.Name, name);
        Assert.Equal(dto.Path, path);
        Assert.Equal(dto.IsDirectory, isDirectory);
        Assert.Equal(dto.Size, size);
        Assert.Equal(dto.LastModified, lastModified);
        Assert.Equal(dto.ItemCount, itemCount);
    }

    // =====================================================================
    // Synthesized ToString
    // =====================================================================

    [Fact]
    public void ToString_IncludesTypeNameAndValues()
    {
        var dto = Create();

        var text = dto.ToString();

        Assert.Contains("FileEntryDto", text);
        Assert.Contains("report.txt", text);
        Assert.Contains("docs/report.txt", text);
    }
}
