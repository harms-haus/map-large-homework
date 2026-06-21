using TestProject.Models;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Models;

/// <summary>
/// Characterization tests for <see cref="CopyRequest"/>.
///
/// <para>
/// These pin the record's observable contract so that the split of
/// <c>Models/FileSystemModels.cs</c> into per-DTO files is provably
/// behavior-preserving: the type stays a sealed record in
/// <c>TestProject.Models</c>, its positional constructor keeps the exact
/// parameter names/types/order
/// <c>(SourcePath, DestinationPath)</c>, and its record semantics (value
/// equality, <c>with</c>, deconstruction) are unchanged regardless of which
/// file declares it. <see cref="CopyRequest"/> is structurally identical to
/// <see cref="MoveRequest"/> but is a distinct type; these tests pin both its
/// own contract and its continued non-interchangeability with Move.
/// </para>
/// </summary>
public class CopyRequestTests
{
    private static CopyRequest Create() => new("src/a.txt", "backup/a.txt");

    // =====================================================================
    // Type contract: sealed record in the Models namespace
    // =====================================================================

    [Fact]
    public void IsSealedRecordInTestProjectModelsNamespace()
    {
        RecordContract.AssertSealedRecordInNamespace(
            typeof(CopyRequest), "TestProject.Models");
    }

    [Fact]
    public void Constructor_ExposesExactPositionalSignature()
    {
        RecordContract.AssertPositionalContract(
            typeof(CopyRequest),
            (nameof(CopyRequest.SourcePath), typeof(string)),
            (nameof(CopyRequest.DestinationPath), typeof(string)));
    }

    [Fact]
    public void Constructor_AssignsEachArgumentToItsProperty()
    {
        var request = new CopyRequest("src/a.txt", "backup/a.txt");

        Assert.Equal("src/a.txt", request.SourcePath);
        Assert.Equal("backup/a.txt", request.DestinationPath);
    }

    // =====================================================================
    // Value equality (record semantics)
    // =====================================================================

    [Fact]
    public void Equals_True_WhenBothPathsMatch()
    {
        RecordContract.AssertEquality(Create(), Create(), expectedEqual: true);
    }

    [Theory]
    [InlineData("other/a.txt", "backup/a.txt")]  // SourcePath differs
    [InlineData("src/a.txt", "other/a.txt")]     // DestinationPath differs
    public void Equals_False_WhenAnyPathDiffers(string source, string destination)
    {
        var a = Create();
        var b = new CopyRequest(source, destination);

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
        var request = Create();
        Assert.True(request.Equals(request));
        Assert.Same(request, request);
    }

    [Fact]
    public void EqualityOperators_AreValueBased()
    {
        var a = Create();
        var b = Create();

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

        var copy = original with { DestinationPath = "archive/b.txt" };

        Assert.NotSame(original, copy);
        Assert.Equal("archive/b.txt", copy.DestinationPath);
        Assert.Equal(original.SourcePath, copy.SourcePath);
        Assert.False(copy.Equals(original));
    }

    // =====================================================================
    // Deconstruction (positional record)
    // =====================================================================

    [Fact]
    public void Deconstruct_ReturnsConstructorArgumentsInOrder()
    {
        var request = Create();

        var (sourcePath, destinationPath) = request;

        Assert.Equal(request.SourcePath, sourcePath);
        Assert.Equal(request.DestinationPath, destinationPath);
    }

    // =====================================================================
    // Synthesized ToString
    // =====================================================================

    [Fact]
    public void ToString_IncludesTypeNameAndPaths()
    {
        var request = Create();

        var text = request.ToString();

        Assert.Contains("CopyRequest", text);
        Assert.Contains("src/a.txt", text);
        Assert.Contains("backup/a.txt", text);
    }

    // =====================================================================
    // Distinctness from MoveRequest (the file split must keep them separate)
    // =====================================================================

    [Fact]
    public void IsADifferentTypeFromMoveRequest()
    {
        Assert.NotEqual(typeof(MoveRequest), typeof(CopyRequest));
    }

    [Fact]
    public void IsNotEqualToMoveRequest_EvenWithIdenticalValues()
    {
        // Record equality checks the synthesized EqualityContract first, so two
        // records of different types are never equal even when every field
        // matches. Pinning that a Copy and a Move remain non-interchangeable.
        var copy = new CopyRequest("a", "b");
        var move = new MoveRequest("a", "b");

        Assert.False(copy.Equals(move));
    }
}
