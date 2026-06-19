using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using TestProject.Models;
using TestProject.Services;
using Xunit;

namespace TestProject.Tests.Services;

/// <summary>
/// Reflection-based contract tests for the file service API surface. These
/// verify the exact shape (namespace, kind, constructor and method
/// signatures) that the implementation step must provide. They are written
/// against the documented contract so the implementation can be validated
/// against a stable interface.
/// </summary>
public class IFileServiceContractTests
{
    // ---------------------------------------------------------------------
    // IFileService
    // ---------------------------------------------------------------------

    [Fact]
    public void IFileService_IsAnInterface_InTestProjectServicesNamespace()
    {
        var type = typeof(IFileService);

        Assert.True(type.IsInterface);
        Assert.Equal("TestProject.Services", type.Namespace);
    }

    [Fact]
    public void IFileService_IsPublic()
    {
        Assert.True(typeof(IFileService).IsPublic);
    }

    [Fact]
    public void IFileService_DeclaresBrowse_ReturningBrowseResultDto_TakingString()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.Browse));

        Assert.NotNull(method);
        Assert.Equal(typeof(BrowseResultDto), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Single(parameters);
        Assert.Equal(typeof(string), parameters[0].ParameterType);
    }

    [Fact]
    public void IFileService_DeclaresSearch_ReturningSearchResultDto_TakingTwoStrings()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.Search));

        Assert.NotNull(method);
        Assert.Equal(typeof(SearchResultDto), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Equal(2, parameters.Length);
        Assert.Equal(typeof(string), parameters[0].ParameterType);
        Assert.Equal(typeof(string), parameters[1].ParameterType);
    }

    [Fact]
    public void IFileService_DeclaresResolveFullPath_ReturningString_TakingString()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.ResolveFullPath));

        Assert.NotNull(method);
        Assert.Equal(typeof(string), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Single(parameters);
        Assert.Equal(typeof(string), parameters[0].ParameterType);
    }

    [Fact]
    public void IFileService_DeclaresUploadAsync_ReturningTask_TakingStringAndIFormFile()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.UploadAsync));

        Assert.NotNull(method);
        Assert.Equal(typeof(Task), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Equal(2, parameters.Length);
        Assert.Equal(typeof(string), parameters[0].ParameterType);
        Assert.Equal(typeof(IFormFile), parameters[1].ParameterType);
    }

    [Fact]
    public void IFileService_DeclaresDelete_ReturnsVoid_TakingString()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.Delete));

        Assert.NotNull(method);
        Assert.Equal(typeof(void), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Single(parameters);
        Assert.Equal(typeof(string), parameters[0].ParameterType);
    }

    [Fact]
    public void IFileService_DeclaresMove_ReturnsVoid_TakingMoveRequest()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.Move));

        Assert.NotNull(method);
        Assert.Equal(typeof(void), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Single(parameters);
        Assert.Equal(typeof(MoveRequest), parameters[0].ParameterType);
    }

    [Fact]
    public void IFileService_DeclaresCopy_ReturnsVoid_TakingCopyRequest()
    {
        var method = typeof(IFileService).GetMethod(nameof(IFileService.Copy));

        Assert.NotNull(method);
        Assert.Equal(typeof(void), method!.ReturnType);
        var parameters = method.GetParameters();
        Assert.Single(parameters);
        Assert.Equal(typeof(CopyRequest), parameters[0].ParameterType);
    }

    // ---------------------------------------------------------------------
    // FileService implementation shape
    // ---------------------------------------------------------------------

    [Fact]
    public void FileService_IsAPublicClass_InTestProjectServicesNamespace()
    {
        var type = typeof(FileService);

        Assert.True(type.IsClass);
        Assert.False(type.IsAbstract);
        Assert.True(type.IsPublic);
        Assert.Equal("TestProject.Services", type.Namespace);
    }

    [Fact]
    public void FileService_ImplementsIFileService()
    {
        Assert.True(typeof(IFileService).IsAssignableFrom(typeof(FileService)));
    }

    [Fact]
    public void FileService_HasConstructorTakingOptionsAndWebHostEnvironment()
    {
        var ctor = typeof(FileService).GetConstructor(new[]
        {
            typeof(IOptions<FileServiceOptions>),
            typeof(IWebHostEnvironment)
        });

        Assert.NotNull(ctor);
    }
}
