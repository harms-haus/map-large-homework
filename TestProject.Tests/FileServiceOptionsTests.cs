using Microsoft.Extensions.Configuration;
using TestProject.Configuration;
using Xunit;

namespace TestProject.Tests;

/// <summary>
/// Characterization tests for <see cref="FileServiceOptions"/>.
///
/// <para>
/// These pin the options object's current observable behavior so that the
/// extraction of the <c>"FileService"</c> configuration-section magic value
/// into a named constant is provably behavior-preserving: the default
/// <see cref="FileServiceOptions.HomeDirectory"/> stays <c>"Home"</c>, and the
/// binding contract (the options bind their <c>HomeDirectory</c> property from
/// a configuration section named <c>FileService</c>) is unchanged regardless
/// of how Program.cs spells the section name. The value-level check on the
/// section name itself lives in <see cref="ProgramWiringTests"/>, which
/// resolves the literal-or-constant form used in <c>GetSection</c>.
/// </para>
/// </summary>
public class FileServiceOptionsTests
{
    [Fact]
    public void HomeDirectory_DefaultsToHome()
    {
        // The documented default. The magic-value extraction must not touch it,
        // so a freshly constructed options object still reports "Home".
        var options = new FileServiceOptions();

        Assert.Equal("Home", options.HomeDirectory);
    }

    [Fact]
    public void HomeDirectory_BindsFromFileServiceConfigSection()
    {
        // Pins the configuration-binding contract independently of Program.cs's
        // wiring: a value under the "FileService" section's HomeDirectory key
        // must land on FileServiceOptions.HomeDirectory. This holds whether the
        // section name is written inline or via a named constant, and it would
        // fail if the HomeDirectory property were renamed (its name must match
        // the config key).
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["FileService:HomeDirectory"] = "BoundHome",
            })
            .Build();

        var options = new FileServiceOptions();
        config.GetSection("FileService").Bind(options);

        Assert.Equal("BoundHome", options.HomeDirectory);
    }

    [Fact]
    public void HomeDirectory_RetainsDefault_WhenSectionOrKeyAbsent()
    {
        // When the FileService section is absent (or HomeDirectory unset) the
        // POCO keeps its coded default rather than going null/empty. This
        // characterizes the fallback path FileService relies on at startup.
        var config = new ConfigurationBuilder().Build();

        var options = new FileServiceOptions();
        config.GetSection("FileService").Bind(options);

        Assert.Equal("Home", options.HomeDirectory);
    }
}
