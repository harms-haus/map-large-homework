using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.Logging;
using TestProject.Controllers;
using TestProject.Models;
using TestProject.Services;
using Xunit;

namespace TestProject.Tests.Controllers;

/// <summary>
/// Reflection-based contract tests for <see cref="FilesController"/>. These
/// verify the class shape, attributes, constructor signature and the exact
/// HTTP endpoint surface (verbs, route templates, parameter bindings and
/// return types) the controller must expose, independently of its runtime
/// behavior. They mirror the style of <c>IFileServiceContractTests</c>.
/// </summary>
public class FilesControllerContractTests
{
    // ---------------------------------------------------------------------
    // Class-level attributes and inheritance
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_IsAPublicNonAbstractClass_InTestProjectControllersNamespace()
    {
        var type = typeof(FilesController);

        Assert.True(type.IsClass);
        Assert.False(type.IsAbstract);
        Assert.True(type.IsPublic);
        Assert.Equal("TestProject.Controllers", type.Namespace);
    }

    [Fact]
    public void FilesController_InheritsFromControllerBase()
    {
        Assert.True(typeof(ControllerBase).IsAssignableFrom(typeof(FilesController)));
    }

    [Fact]
    public void FilesController_HasApiControllerAttribute()
    {
        var attr = typeof(FilesController).GetCustomAttribute<ApiControllerAttribute>();

        Assert.NotNull(attr);
    }

    [Fact]
    public void FilesController_HasRouteAttribute_WithApiFilesControllerTemplate()
    {
        // "api/[controller]" resolves to "/api/files" because the controller
        // name (type name minus the "Controller" suffix) is "Files".
        var attr = typeof(FilesController).GetCustomAttribute<RouteAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("api/[controller]", attr!.Template);
    }

    [Fact]
    public void FilesController_TypeNameEndsWithController_SoRouteTokenResolvesToFiles()
    {
        var name = typeof(FilesController).Name;

        Assert.EndsWith("Controller", name);
        Assert.Equal("Files", name.Substring(0, name.Length - "Controller".Length));
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_HasPublicConstructor_TakingIFileServiceAndLogger()
    {
        var ctor = typeof(FilesController).GetConstructor(new[]
        {
            typeof(IFileService),
            typeof(ILogger<FilesController>)
        });

        Assert.NotNull(ctor);
        Assert.True(ctor!.IsPublic);
    }

    [Fact]
    public void FilesController_DoesNotDeclareOldTestControllerSurface()
    {
        // The old TestController exposed a parameterless Get(); the new
        // controller must not carry that legacy method.
        var get = typeof(FilesController).GetMethod("Get", Type.EmptyTypes);

        Assert.Null(get);
    }

    // ---------------------------------------------------------------------
    // Browse
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresBrowse_ReturningActionResultOfBrowseResultDto()
    {
        var method = GetMethod("Browse");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(ActionResult<BrowseResultDto>), method.ReturnType);
    }

    [Fact]
    public void FilesController_Browse_HasHttpGetAttributeWithBrowseTemplate()
    {
        var method = GetMethod("Browse");

        var attr = method.GetCustomAttribute<HttpGetAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("browse", attr!.Template);
    }

    [Fact]
    public void FilesController_Browse_HasSingleFromQueryStringNullablePathParameter()
    {
        var method = GetMethod("Browse");

        var args = method.GetParameters();
        Assert.Single(args);
        Assert.Equal("path", args[0].Name);
        Assert.Equal(typeof(string), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromQueryAttribute>());
    }

    // ---------------------------------------------------------------------
    // Search
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresSearch_ReturningActionResultOfSearchResultDto()
    {
        var method = GetMethod("Search");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(ActionResult<SearchResultDto>), method.ReturnType);
    }

    [Fact]
    public void FilesController_Search_HasHttpGetAttributeWithSearchTemplate()
    {
        var method = GetMethod("Search");

        var attr = method.GetCustomAttribute<HttpGetAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("search", attr!.Template);
    }

    [Fact]
    public void FilesController_Search_HasTwoFromQueryStringParameters()
    {
        var method = GetMethod("Search");

        var args = method.GetParameters();
        Assert.Equal(2, args.Length);
        Assert.Equal("query", args[0].Name);
        Assert.Equal(typeof(string), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromQueryAttribute>());
        Assert.Equal("path", args[1].Name);
        Assert.Equal(typeof(string), args[1].ParameterType);
        Assert.NotNull(args[1].GetCustomAttribute<FromQueryAttribute>());
    }

    // ---------------------------------------------------------------------
    // Upload
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresUpload_ReturningTaskOfIActionResult()
    {
        var method = GetMethod("Upload");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(Task<IActionResult>), method.ReturnType);
    }

    [Fact]
    public void FilesController_Upload_HasHttpPostAttributeWithUploadTemplate()
    {
        var method = GetMethod("Upload");

        var attr = method.GetCustomAttribute<HttpPostAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("upload", attr!.Template);
    }

    [Fact]
    public void FilesController_Upload_HasFromQueryPathAndFromFormFileParameters()
    {
        var method = GetMethod("Upload");

        var args = method.GetParameters();
        Assert.Equal(2, args.Length);
        Assert.Equal("path", args[0].Name);
        Assert.Equal(typeof(string), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromQueryAttribute>());
        Assert.Equal("file", args[1].Name);
        Assert.Equal(typeof(IFormFile), args[1].ParameterType);
        Assert.NotNull(args[1].GetCustomAttribute<FromFormAttribute>());
    }

    // ---------------------------------------------------------------------
    // Download
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresDownload_ReturningIActionResult()
    {
        var method = GetMethod("Download");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(IActionResult), method.ReturnType);
    }

    [Fact]
    public void FilesController_Download_HasHttpGetAttributeWithDownloadTemplate()
    {
        var method = GetMethod("Download");

        var attr = method.GetCustomAttribute<HttpGetAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("download", attr!.Template);
    }

    [Fact]
    public void FilesController_Download_HasSingleFromQueryStringPathParameter()
    {
        var method = GetMethod("Download");

        var args = method.GetParameters();
        Assert.Single(args);
        Assert.Equal("path", args[0].Name);
        Assert.Equal(typeof(string), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromQueryAttribute>());
    }

    // ---------------------------------------------------------------------
    // Delete
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresDelete_ReturningIActionResult()
    {
        var method = GetMethod("Delete");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(IActionResult), method.ReturnType);
    }

    [Fact]
    public void FilesController_Delete_HasHttpDeleteAttributeWithDeleteTemplate()
    {
        var method = GetMethod("Delete");

        var attr = method.GetCustomAttribute<HttpDeleteAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("delete", attr!.Template);
    }

    [Fact]
    public void FilesController_Delete_HasSingleFromQueryStringPathParameter()
    {
        var method = GetMethod("Delete");

        var args = method.GetParameters();
        Assert.Single(args);
        Assert.Equal("path", args[0].Name);
        Assert.Equal(typeof(string), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromQueryAttribute>());
    }

    // ---------------------------------------------------------------------
    // Move
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresMove_ReturningIActionResult()
    {
        var method = GetMethod("Move");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(IActionResult), method.ReturnType);
    }

    [Fact]
    public void FilesController_Move_HasHttpPostAttributeWithMoveTemplate()
    {
        var method = GetMethod("Move");

        var attr = method.GetCustomAttribute<HttpPostAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("move", attr!.Template);
    }

    [Fact]
    public void FilesController_Move_HasSingleFromBodyMoveRequestParameter()
    {
        var method = GetMethod("Move");

        var args = method.GetParameters();
        Assert.Single(args);
        Assert.Equal("request", args[0].Name);
        Assert.Equal(typeof(MoveRequest), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromBodyAttribute>());
    }

    // ---------------------------------------------------------------------
    // Copy
    // ---------------------------------------------------------------------

    [Fact]
    public void FilesController_DeclaresCopy_ReturningIActionResult()
    {
        var method = GetMethod("Copy");

        Assert.True(method.IsPublic);
        Assert.Equal(typeof(IActionResult), method.ReturnType);
    }

    [Fact]
    public void FilesController_Copy_HasHttpPostAttributeWithCopyTemplate()
    {
        var method = GetMethod("Copy");

        var attr = method.GetCustomAttribute<HttpPostAttribute>();

        Assert.NotNull(attr);
        Assert.Equal("copy", attr!.Template);
    }

    [Fact]
    public void FilesController_Copy_HasSingleFromBodyCopyRequestParameter()
    {
        var method = GetMethod("Copy");

        var args = method.GetParameters();
        Assert.Single(args);
        Assert.Equal("request", args[0].Name);
        Assert.Equal(typeof(CopyRequest), args[0].ParameterType);
        Assert.NotNull(args[0].GetCustomAttribute<FromBodyAttribute>());
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private static MethodInfo GetMethod(string name)
    {
        var method = typeof(FilesController).GetMethod(name);
        Assert.NotNull(method);
        return method!;
    }
}
