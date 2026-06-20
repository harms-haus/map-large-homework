namespace TestProject {
    public class Program {
        public static void Main(string[] args) {
            var builder = WebApplication.CreateBuilder(args);

            // Add services to the container.

            builder.Services.AddControllers();

            // Bind the FileService configuration section and register the
            // path-safe IFileService implementation so controllers can be
            // activated through dependency injection.
            builder.Services.Configure<TestProject.Configuration.FileServiceOptions>(
                builder.Configuration.GetSection("FileService"));
            builder.Services.AddSingleton<TestProject.Services.IFileService, TestProject.Services.FileService>();

            var app = builder.Build();

            // Configure the HTTP request pipeline.

            app.UseHttpsRedirection();

            app.UseDefaultFiles();

            app.UseStaticFiles();

            app.MapControllers();

            app.MapFallbackToFile("index.html");

            app.Run();
        }
    }
}