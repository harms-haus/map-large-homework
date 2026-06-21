namespace TestProject.Configuration;

public class FileServiceOptions
{
    /// <summary>Configuration section name used when binding options from <c>appsettings.json</c>.</summary>
    public const string SectionName = "FileService";

    public string HomeDirectory { get; set; } = "Home";
}
