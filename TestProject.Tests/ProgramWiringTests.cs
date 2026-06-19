using System;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace TestProject.Tests;

/// <summary>
/// Tests for the dependency-injection wiring and HTTP request-pipeline
/// ordering in <c>Program.cs</c>.
///
/// The application bootstrap is expected to:
/// <list type="bullet">
/// <item>Bind <see cref="TestProject.FileServiceOptions"/> from the
/// "FileService" configuration section via
/// <c>builder.Services.Configure&lt;FileServiceOptions&gt;(
/// builder.Configuration.GetSection("FileService"))</c>.</item>
/// <item>Register <see cref="TestProject.Services.IFileService"/> backed by
/// <see cref="TestProject.Services.FileService"/> as a singleton.</item>
/// <item>Configure the middleware pipeline in the exact order
/// <c>UseHttpsRedirection</c> -&gt; <c>UseDefaultFiles</c> -&gt;
/// <c>UseStaticFiles</c> -&gt; <c>MapControllers</c> -&gt;
/// <c>MapFallbackToFile("index.html")</c> -&gt; <c>Run</c>.</item>
/// </list>
///
/// These assertions parse the source of <c>Program.cs</c> directly so the
/// contract is locked in regardless of formatting choices (fully-qualified
/// names or added <c>using</c> directives). The file is located by walking up
/// from the test output directory to the folder that contains
/// <c>TestProject.csproj</c>.
/// </summary>
public class ProgramWiringTests
{
    private static readonly string ProgramSource = LoadProgramSource();

    private const string OptionsConfigurePattern =
        @"Services\s*\.\s*Configure\s*<[^>]*FileServiceOptions[^>]*>";

    private const string FileServiceSectionPattern =
        @"GetSection\s*\(\s*""FileService""\s*\)";

    private const string SingletonPattern =
        @"Services\s*\.\s*AddSingleton\s*<[^>]*IFileService[^>]*,\s*[^>]*FileService\s*>";

    private const string FallbackIndexHtmlPattern =
        @"MapFallbackToFile\s*\(\s*""index\.html""\s*\)";

    private const string RunPattern = @"\.\s*Run\s*\(\s*\)";

    /// <summary>
    /// Walks up from the test assembly output directory until it finds a
    /// folder containing both <c>TestProject.csproj</c> and <c>Program.cs</c>,
    /// then returns the Program.cs source text.
    /// </summary>
    private static string LoadProgramSource()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var csprojPath = Path.Combine(dir.FullName, "TestProject.csproj");
            if (File.Exists(csprojPath))
            {
                var programPath = Path.Combine(dir.FullName, "Program.cs");
                if (File.Exists(programPath))
                {
                    return File.ReadAllText(programPath);
                }
            }

            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            "Could not locate Program.cs next to TestProject.csproj by walking up " +
            "from the test output directory (" + AppContext.BaseDirectory + ").");
    }

    /// <summary>Returns the index of the first match of <paramref name="pattern"/>,
    /// or -1 when it is absent.</summary>
    private static int IndexOf(string pattern)
    {
        var match = Regex.Match(ProgramSource, pattern);
        return match.Success ? match.Index : -1;
    }

    /// <summary>Returns the index of the first occurrence of a simple method
    /// call like <c>UseDefaultFiles(</c>, or -1 when absent.</summary>
    private static int CallIndex(string methodName) =>
        IndexOf(Regex.Escape(methodName) + @"\s*\(");

    /// <summary>Counts how many times <paramref name="pattern"/> matches.</summary>
    private static int Count(string pattern) =>
        Regex.Matches(ProgramSource, pattern).Count;

    private static void AssertPresent(string pattern, string description)
    {
        Assert.True(IndexOf(pattern) >= 0,
            $"Expected {description} to be present in Program.cs.");
    }

    private static void AssertCallOrder(string earlier, string later)
    {
        var earlierIdx = CallIndex(earlier);
        var laterIdx = CallIndex(later);

        Assert.True(earlierIdx >= 0, $"Expected '{earlier}(' in Program.cs.");
        Assert.True(laterIdx >= 0, $"Expected '{later}(' in Program.cs.");
        Assert.True(earlierIdx < laterIdx,
            $"'{earlier}' must appear before '{later}' in the Program.cs pipeline.");
    }

    // =====================================================================
    // Template preservation (unchanged scaffolding)
    // =====================================================================

    [Fact]
    public void Program_Preserves_WebApplication_CreateBuilder()
    {
        AssertPresent(@"WebApplication\s*\.\s*CreateBuilder\s*\(",
            "WebApplication.CreateBuilder(args)");
    }

    [Fact]
    public void Program_Preserves_AddControllers()
    {
        AssertPresent(@"Services\s*\.\s*AddControllers\s*\(",
            "builder.Services.AddControllers()");
    }

    [Fact]
    public void Program_Preserves_Build()
    {
        AssertPresent(@"\.\s*Build\s*\(\s*\)", "builder.Build()");
    }

    [Fact]
    public void Program_StillDeclaresPublicProgramClassWithMain()
    {
        AssertPresent(@"class\s+Program\b", "a Program class declaration");
        AssertPresent(@"(public|private|internal)?\s*static\s+void\s+Main\s*\(",
            "a static void Main entry point");
    }

    // =====================================================================
    // Service registration: FileServiceOptions
    // =====================================================================

    [Fact]
    public void Program_Registers_FileServiceOptions_OnServicesCollection()
    {
        AssertPresent(OptionsConfigurePattern,
            "builder.Services.Configure<...FileServiceOptions>");
    }

    [Fact]
    public void Program_Registers_FileServiceOptions_FromFileServiceSection()
    {
        var configureIdx = IndexOf(OptionsConfigurePattern);
        var sectionIdx = IndexOf(FileServiceSectionPattern);

        Assert.True(sectionIdx >= 0,
            "Expected builder.Configuration.GetSection(\"FileService\") in Program.cs.");

        // The section should be supplied to the Configure call (i.e. it appears
        // right after the Configure<FileServiceOptions> token).
        Assert.True(configureIdx >= 0 && sectionIdx > configureIdx,
            "GetSection(\"FileService\") should be the argument passed to " +
            "Configure<FileServiceOptions>.");
        Assert.True(sectionIdx - configureIdx < 250,
            "GetSection(\"FileService\") should be supplied directly to the " +
            "Configure<FileServiceOptions>(...) call.");
    }

    [Fact]
    public void Program_Registers_FileServiceOptions_AfterAddControllers_AndBeforeBuild()
    {
        var addControllers = CallIndex("AddControllers");
        var configure = IndexOf(OptionsConfigurePattern);
        var build = IndexOf(@"\.\s*Build\s*\(\s*\)");

        Assert.True(addControllers >= 0 && configure > addControllers,
            "Configure<FileServiceOptions> must be added after AddControllers().");
        Assert.True(build < 0 || configure < build,
            "Configure<FileServiceOptions> must be added before builder.Build().");
    }

    // =====================================================================
    // Service registration: IFileService -> FileService singleton
    // =====================================================================

    [Fact]
    public void Program_Registers_IFileService_AsSingleton_FileService()
    {
        AssertPresent(SingletonPattern,
            "builder.Services.AddSingleton<...IFileService..., ...FileService>()");
    }

    [Fact]
    public void Program_Registers_IFileService_AsSingleton_ExactlyOnce()
    {
        Assert.Equal(1, Count(SingletonPattern));
    }

    [Fact]
    public void Program_Registers_IFileService_AfterAddControllers_AndBeforeBuild()
    {
        var addControllers = CallIndex("AddControllers");
        var singleton = IndexOf(SingletonPattern);
        var build = IndexOf(@"\.\s*Build\s*\(\s*\)");

        Assert.True(addControllers >= 0 && singleton > addControllers,
            "AddSingleton<IFileService, FileService> must be added after AddControllers().");
        Assert.True(build < 0 || singleton < build,
            "AddSingleton<IFileService, FileService> must be added before builder.Build().");
    }

    [Fact]
    public void Program_Registers_Options_BeforeIFileService()
    {
        var configure = IndexOf(OptionsConfigurePattern);
        var singleton = IndexOf(SingletonPattern);

        Assert.True(configure >= 0 && singleton >= 0 && configure < singleton,
            "FileServiceOptions should be configured before the FileService singleton " +
            "that depends on them is registered.");
    }

    // =====================================================================
    // Pipeline statements are present exactly once
    // =====================================================================

    [Fact]
    public void Program_Pipeline_UsesHttpsRedirection_ExactlyOnce()
    {
        Assert.Equal(1, Count(@"UseHttpsRedirection\s*\("));
    }

    [Fact]
    public void Program_Pipeline_UsesDefaultFiles_ExactlyOnce()
    {
        Assert.Equal(1, Count(@"UseDefaultFiles\s*\("));
    }

    [Fact]
    public void Program_Pipeline_UsesStaticFiles_ExactlyOnce()
    {
        Assert.Equal(1, Count(@"UseStaticFiles\s*\("));
    }

    [Fact]
    public void Program_Pipeline_MapsControllers_ExactlyOnce()
    {
        Assert.Equal(1, Count(@"MapControllers\s*\("));
    }

    [Fact]
    public void Program_Pipeline_MapsFallbackToIndexHtml_ExactlyOnce()
    {
        Assert.Equal(1, Count(FallbackIndexHtmlPattern));
    }

    // =====================================================================
    // Pipeline ordering
    // =====================================================================

    [Fact]
    public void Program_Pipeline_HttpsRedirection_ComesBeforeDefaultFiles()
    {
        AssertCallOrder("UseHttpsRedirection", "UseDefaultFiles");
    }

    [Fact]
    public void Program_Pipeline_DefaultFiles_ComesBeforeStaticFiles()
    {
        // DefaultFiles MUST run before StaticFiles so that requests for "/"
        // are rewritten to index.html before the static file middleware looks
        // for them.
        AssertCallOrder("UseDefaultFiles", "UseStaticFiles");
    }

    [Fact]
    public void Program_Pipeline_StaticFiles_ComesBeforeMapControllers()
    {
        AssertCallOrder("UseStaticFiles", "MapControllers");
    }

    [Fact]
    public void Program_Pipeline_MapControllers_ComesBeforeFallback()
    {
        var controllers = CallIndex("MapControllers");
        var fallback = IndexOf(FallbackIndexHtmlPattern);

        Assert.True(controllers >= 0, "Expected 'MapControllers(' in Program.cs.");
        Assert.True(fallback >= 0, "Expected MapFallbackToFile(\"index.html\") in Program.cs.");
        Assert.True(controllers < fallback,
            "MapControllers must come before MapFallbackToFile so that API routes " +
            "take precedence over the SPA fallback.");
    }

    [Fact]
    public void Program_Pipeline_Fallback_ComesBeforeRun()
    {
        var fallback = IndexOf(FallbackIndexHtmlPattern);
        var run = IndexOf(RunPattern);

        Assert.True(fallback >= 0, "Expected MapFallbackToFile(\"index.html\") in Program.cs.");
        Assert.True(run >= 0, "Expected app.Run() in Program.cs.");
        Assert.True(fallback < run,
            "MapFallbackToFile must be registered before app.Run().");
    }

    [Fact]
    public void Program_Pipeline_Build_ComesBeforeAnyMiddleware()
    {
        var build = IndexOf(@"\.\s*Build\s*\(\s*\)");
        var https = CallIndex("UseHttpsRedirection");

        Assert.True(build >= 0, "Expected builder.Build() in Program.cs.");
        Assert.True(https >= 0, "Expected UseHttpsRedirection() in Program.cs.");
        Assert.True(build < https,
            "builder.Build() must occur before the request pipeline is configured.");
    }

    [Fact]
    public void Program_Pipeline_FullOrder_IsHttpsRedirection_DefaultFiles_StaticFiles_MapControllers_Fallback_Run()
    {
        var https = CallIndex("UseHttpsRedirection");
        var defaults = CallIndex("UseDefaultFiles");
        var stat = CallIndex("UseStaticFiles");
        var controllers = CallIndex("MapControllers");
        var fallback = IndexOf(FallbackIndexHtmlPattern);
        var run = IndexOf(RunPattern);

        Assert.True(https >= 0 && defaults >= 0 && stat >= 0 &&
                    controllers >= 0 && fallback >= 0 && run >= 0,
            "All six expected pipeline statements must be present in Program.cs.");

        Assert.True(https < defaults,
            "Order: UseHttpsRedirection must precede UseDefaultFiles.");
        Assert.True(defaults < stat,
            "Order: UseDefaultFiles must precede UseStaticFiles.");
        Assert.True(stat < controllers,
            "Order: UseStaticFiles must precede MapControllers.");
        Assert.True(controllers < fallback,
            "Order: MapControllers must precede MapFallbackToFile.");
        Assert.True(fallback < run,
            "Order: MapFallbackToFile must precede Run.");
    }

    // =====================================================================
    // End-to-end ordering of service registration vs. pipeline
    // =====================================================================

    [Fact]
    public void Program_AllServiceRegistrations_HappenBeforeAnyMiddleware()
    {
        var lastRegistration = Math.Max(
            IndexOf(OptionsConfigurePattern),
            IndexOf(SingletonPattern));
        var firstMiddleware = CallIndex("UseHttpsRedirection");

        Assert.True(lastRegistration >= 0 && firstMiddleware >= 0,
            "Expected both service registrations and pipeline middleware in Program.cs.");
        Assert.True(lastRegistration < firstMiddleware,
            "All DI registrations must occur before the HTTP pipeline is configured.");
    }
}
