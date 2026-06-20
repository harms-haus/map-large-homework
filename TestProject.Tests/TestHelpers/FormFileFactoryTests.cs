using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace TestProject.Tests.TestHelpers;

/// <summary>
/// Characterization tests for the <c>CreateFormFile(string fileName, string
/// content)</c> test helper, which builds an <see cref="IFormFile"/> from an
/// in-memory UTF-8 string.
///
/// <para><b>Why discovery-based:</b> the task consolidates three byte-identical
/// private copies of this helper (in <c>FileServiceTests</c>,
/// <c>FilesControllerTests</c>, and <c>FakeFileServiceTests</c>) into a single
/// shared <c>FormFileFactory.CreateFormFile</c>. Because the helper is
/// <c>private</c> today and <c>FormFileFactory</c> does not exist yet, a test
/// that references the future type directly cannot compile against the current
/// code. Instead these tests discover <em>every</em> static
/// <c>CreateFormFile(string, string) : IFormFile</c> method anywhere in the
/// test assembly and assert the documented contract against each one. This
/// keeps the suite green before the extraction (finds the three private
/// copies) and after it (finds the consolidated <c>FormFileFactory</c>, or
/// <c>FormFileFactory</c> plus any thin forwarding wrappers the implementer
/// chooses to leave behind) — proving the extraction is behavior-preserving
/// regardless of how the call sites are rewired.</para>
///
/// <para>The pinned contract is exactly what the current implementation
/// produces:
/// <code>
/// var bytes = Encoding.UTF8.GetBytes(content);
/// var stream = new MemoryStream(bytes);
/// return new FormFile(stream, 0, bytes.Length, "file", fileName);
/// </code>
/// i.e. <see cref="IFormFile.FileName"/> echoes the provided name, the form
/// field <see cref="IFormFile.Name"/> is the literal <c>"file"</c>,
/// <see cref="IFormFile.Length"/> is the UTF-8 byte count of the content
/// (not the character count), the readable stream yields the content verbatim,
/// each call returns a fresh independent instance, and the headers are left
/// unpopulated (so the <c>ContentDisposition</c>/<c>ContentType</c> getters
/// throw, as they do today).</para>
/// </summary>
public class FormFileFactoryTests
{
    /// <summary>
    /// Every <c>CreateFormFile(string, string) : IFormFile</c> static method
    /// declared anywhere in the test assembly, regardless of accessibility or
    /// declaring type. Before the extraction this is the three private copies;
    /// after it, it is <c>FormFileFactory.CreateFormFile</c> (and any
    /// forwarding wrappers left behind).
    /// </summary>
    public static IEnumerable<object[]> CreateFormFileMethods()
        => DiscoverCreateFormFileMethods().Select(m => new object[] { m });

    private static IReadOnlyList<MethodInfo> DiscoverCreateFormFileMethods()
    {
        var assembly = typeof(FormFileFactoryTests).Assembly;
        var found = new List<MethodInfo>();

        foreach (var type in assembly.GetTypes())
        {
            foreach (var method in type.GetMethods(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
            {
                if (method.Name != "CreateFormFile")
                {
                    continue;
                }

                var parameters = method.GetParameters();
                if (parameters.Length != 2
                    || parameters[0].ParameterType != typeof(string)
                    || parameters[1].ParameterType != typeof(string)
                    || method.ReturnType != typeof(IFormFile))
                {
                    continue;
                }

                found.Add(method);
            }
        }

        return found;
    }

    private static IFormFile Invoke(MethodInfo method, string fileName, string content)
        => (IFormFile)method.Invoke(null, new object[] { fileName, content })!;

    // =====================================================================
    // Existence — guards against a botched extraction that removes the copies
    // without providing the shared helper. (That would also fail to compile,
    // but this makes the intent explicit and survives a forwarding-wrapper
    // implementation.)
    // =====================================================================

    [Fact]
    public void At_Least_One_CreateFormFile_Helper_Exists_In_The_Test_Assembly()
    {
        var methods = DiscoverCreateFormFileMethods();

        Assert.NotEmpty(methods);
    }

    // =====================================================================
    // Non-null result.
    // =====================================================================

    [Theory]
    [MemberData(nameof(CreateFormFileMethods))]
    public void Returns_A_NonNull_IFormFile(MethodInfo method)
    {
        var file = Invoke(method, "upload.txt", "payload");

        Assert.NotNull(file);
        Assert.IsAssignableFrom<IFormFile>(file);
    }

    // =====================================================================
    // FileName echoes the provided value verbatim, including values that
    // contain path separators (the helper does no normalization).
    // =====================================================================

    [Theory]
    [InlineData("upload.txt")]
    [InlineData("report.txt")]
    [InlineData("no-extension")]
    [InlineData("dir/sub/deep.txt")]
    [InlineData("with space and UPPER.txt")]
    public void FileName_Echoes_The_Provided_Value_Verbatim(string fileName)
    {
        foreach (var method in DiscoverCreateFormFileMethods())
        {
            var file = Invoke(method, fileName, "x");

            Assert.Equal(fileName, file.FileName);
        }
    }

    // =====================================================================
    // The form field Name is the literal "file" (the 4th FormFile ctor
    // argument). This is the single most likely thing to change in a
    // hand-written rewrite, so it gets its own assertion.
    // =====================================================================

    [Theory]
    [MemberData(nameof(CreateFormFileMethods))]
    public void FormFieldName_Is_The_Literal_File(MethodInfo method)
    {
        var file = Invoke(method, "upload.txt", "payload");

        Assert.Equal("file", file.Name);
    }

    // =====================================================================
    // Length is the UTF-8 *byte* count of the content, not the character
    // count. Multi-byte and empty content are the boundary cases that would
    // break a naive `content.Length` reimplementation.
    // =====================================================================

    [Theory]
    [InlineData("", 0)]
    [InlineData("a", 1)]
    [InlineData("payload", 7)]
    [InlineData("é", 2)]       // U+00E9, two UTF-8 bytes
    [InlineData("€", 3)]       // U+20AC, three UTF-8 bytes
    [InlineData("café", 5)]    // c,a,f are 1 byte each; é is 2 → 5
    public void Length_Is_The_Utf8_Byte_Count_Of_The_Content(string content, int expectedBytes)
    {
        foreach (var method in DiscoverCreateFormFileMethods())
        {
            var file = Invoke(method, "f.txt", content);

            Assert.Equal(expectedBytes, file.Length);
            // Cross-check against the framework's own byte counter so the
            // expected value isn't a hand-typed magic number.
            Assert.Equal(Encoding.UTF8.GetByteCount(content), file.Length);
        }
    }

    // =====================================================================
    // The readable stream yields the content verbatim (round-trips through
    // UTF-8), including multi-byte content.
    // =====================================================================

    [Theory]
    [InlineData("payload")]
    [InlineData("")]
    [InlineData("line1\nline2")]
    [InlineData("café €")]
    public async Task OpenReadStream_Yields_The_Exact_Content(string content)
    {
        foreach (var method in DiscoverCreateFormFileMethods())
        {
            var file = Invoke(method, "f.txt", content);

            using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8);
            var actual = await reader.ReadToEndAsync();

            Assert.Equal(content, actual);
        }
    }

    [Theory]
    [MemberData(nameof(CreateFormFileMethods))]
    public async Task CopyToAsync_Writes_The_Exact_Content(MethodInfo method)
    {
        const string content = "payload-bytes";
        var file = Invoke(method, "f.txt", content);

        using var destination = new MemoryStream();
        await file.CopyToAsync(destination);

        Assert.Equal(content, Encoding.UTF8.GetString(destination.ToArray()));
        Assert.Equal(Encoding.UTF8.GetByteCount(content), destination.Length);
    }

    // =====================================================================
    // Each invocation returns a fresh, independent instance with its own
    // backing stream. Reading one instance must not disturb another.
    // =====================================================================

    [Theory]
    [MemberData(nameof(CreateFormFileMethods))]
    public async Task Returns_A_Fresh_Independent_Instance_Each_Call(MethodInfo method)
    {
        var first = Invoke(method, "a.txt", "AAA");
        var second = Invoke(method, "b.txt", "BBB");

        Assert.NotSame(first, second);

        // Fully consume the first instance's stream...
        using (var reader = new StreamReader(first.OpenReadStream()))
        {
            Assert.Equal("AAA", await reader.ReadToEndAsync());
        }

        // ...the second instance must still be readable and intact, proving
        // the two do not share a backing stream.
        using (var reader = new StreamReader(second.OpenReadStream()))
        {
            Assert.Equal("BBB", await reader.ReadToEndAsync());
        }
        Assert.Equal("b.txt", second.FileName);
    }

    // =====================================================================
    // Consolidation safety: every discovered implementation must produce the
    // identical observable contract for the same inputs. After the extraction
    // there is exactly one implementation (FormFileFactory), but if any
    // forwarding wrappers remain they must agree byte-for-byte.
    // =====================================================================

    [Fact]
    public async Task All_Implementations_Produce_The_Same_Observable_Contract()
    {
        var methods = DiscoverCreateFormFileMethods().ToArray();

        // Skip when only one implementation exists — there is nothing to
        // cross-check, and the per-method theories above already cover it.
        if (methods.Length < 2)
        {
            return;
        }

        var contracts = new List<(string FileName, string Name, long Length, string Content)>();
        foreach (var method in methods)
        {
            var file = Invoke(method, "shared.txt", "shared-content");
            using var reader = new StreamReader(file.OpenReadStream());
            contracts.Add((file.FileName, file.Name, file.Length, await reader.ReadToEndAsync()));
        }

        var distinct = contracts.Distinct().ToArray();
        Assert.True(
            distinct.Length == 1,
            $"CreateFormFile implementations disagree: {string.Join(" | ", contracts)}");
    }

    // =====================================================================
    // The current implementation does not populate Headers, so the
    // ContentDisposition getter throws (this is observable today and must be
    // preserved by a verbatim extraction). Asserting it documents the behavior
    // and would catch an "improvement" that starts setting headers.
    // =====================================================================

    [Theory]
    [MemberData(nameof(CreateFormFileMethods))]
    public void Leaves_Headers_Unpopulated_ContentDispositionGetterThrows(MethodInfo method)
    {
        var file = Invoke(method, "upload.txt", "payload");

        // Accessing the derived ContentDisposition property dereferences an
        // uninitialized header and throws today; the contract is "headers are
        // not set".
        Assert.ThrowsAny<Exception>(() => _ = file.ContentDisposition);
    }
}
