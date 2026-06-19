using System;
using TestProject;
using Xunit;

namespace TestProject.Tests;

/// <summary>
/// Tests for <see cref="FileServiceOptions"/>, the strongly typed options
/// object that configures the server side home directory.
/// </summary>
public class FileServiceOptionsTests
{
    [Fact]
    public void Constructor_DefaultHomeDirectory_IsHome()
    {
        var options = new FileServiceOptions();

        Assert.Equal("Home", options.HomeDirectory);
    }

    [Fact]
    public void HomeDirectory_IsMutable()
    {
        var options = new FileServiceOptions();

        options.HomeDirectory = "/var/data/files";

        Assert.Equal("/var/data/files", options.HomeDirectory);
    }

    [Theory]
    [InlineData("MyFiles")]
    [InlineData("")]
    [InlineData("   ")]
    public void HomeDirectory_CanBeSetToArbitraryStringValue(string value)
    {
        var options = new FileServiceOptions();

        options.HomeDirectory = value;

        Assert.Equal(value, options.HomeDirectory);
    }

    [Fact]
    public void HomeDirectory_IsAStringProperty()
    {
        var property = typeof(FileServiceOptions).GetProperty(nameof(FileServiceOptions.HomeDirectory));

        Assert.NotNull(property);
        Assert.Equal(typeof(string), property!.PropertyType);
        Assert.True(property.CanRead);
        Assert.True(property.CanWrite);
    }

    [Fact]
    public void FileServiceOptions_IsAPublicClass_InTestProjectNamespace()
    {
        var type = typeof(FileServiceOptions);

        Assert.True(type.IsClass);
        Assert.True(type.IsPublic);
        Assert.Equal("TestProject", type.Namespace);
    }
}
