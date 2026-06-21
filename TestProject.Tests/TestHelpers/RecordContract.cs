using System.Reflection;
using Xunit;

namespace TestProject.Tests.TestHelpers;

/// <summary>
/// Reflection-based assertions that pin down the compiled contract of a
/// positional <c>record</c> type. Used by the <c>TestProject.Models</c> DTO
/// characterization tests so that splitting <c>Models/FileSystemModels.cs</c>
/// into per-DTO files is provably behavior-preserving: whichever file a type
/// ends up declared in, its namespace, sealed-record kind, primary-constructor
/// signature (parameter names, types, and order), and the set of public
/// init-only properties must remain byte-for-byte the same.
/// </summary>
internal static class RecordContract
{
    /// <summary>
    /// Asserts <paramref name="type"/> is a sealed, non-abstract, reference-type
    /// record living in <paramref name="expectedNamespace"/>.
    /// </summary>
    public static void AssertSealedRecordInNamespace(Type type, string expectedNamespace)
    {
        Assert.True(type.IsClass,
            $"{type.Name} must be a reference type (class), not a struct.");
        Assert.True(type.IsSealed,
            $"{type.Name} must be sealed (the DTOs are declared `sealed record`).");
        Assert.True(!type.IsAbstract,
            $"{type.Name} must not be abstract.");
        Assert.Equal(expectedNamespace, type.Namespace);
        Assert.True(IsRecord(type),
            $"{type.Name} must be a record (expected the synthesized copy method).");
    }

    /// <summary>
    /// Asserts <paramref name="type"/> declares exactly one public instance
    /// constructor whose parameters match <paramref name="expected"/> in name,
    /// type, and order, AND that each parameter is surfaced as a public
    /// property of the same name and type with no extra public properties.
    /// This pins the positional-record shape (constructor + auto-properties) so
    /// a moved DTO cannot silently gain, lose, reorder, rename, or retype a
    /// field. Note nullable-reference annotations (<c>string?</c> vs
    /// <c>string</c>) are not reflected in <see cref="Type"/> at runtime, so
    /// nullability is pinned separately via construction in the per-type tests.
    /// </summary>
    public static void AssertPositionalContract(
        Type type,
        params (string Name, Type Type)[] expected)
    {
        var constructors = type.GetConstructors();
        Assert.True(constructors.Length == 1,
            $"{type.Name} must declare exactly one public constructor (the " +
            "positional primary constructor); the protected copy constructor " +
            "synthesized for records must not be public. " +
            $"Found {constructors.Length}.");
        var primary = constructors[0];

        var parameters = primary.GetParameters();
        Assert.Equal(expected.Length, parameters.Length);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.True(
                parameters[i].Name == expected[i].Name &&
                parameters[i].ParameterType == expected[i].Type,
                $"{type.Name} constructor parameter #{i} must be " +
                $"{expected[i].Type.Name} {expected[i].Name}, but was " +
                $"{parameters[i].ParameterType.Name} {parameters[i].Name}.");
        }

        // Public instance properties: exactly the positional ones. The
        // synthesized protected `EqualityContract` property is excluded because
        // GetProperties() returns only public members.
        var properties = type.GetProperties();
        Assert.Equal(expected.Length, properties.Length);
        foreach (var (name, propertyType) in expected)
        {
            var property = type.GetProperty(name);
            Assert.NotNull(property);
            Assert.True(property!.CanRead, $"{type.Name}.{name} must have a getter.");
            Assert.True(property.CanWrite,
                $"{type.Name}.{name} must have an init/set accessor so `with` works.");
            Assert.Equal(propertyType, property.PropertyType);
        }
    }

    /// <summary>
    /// Asserts record value-equality semantics for two instances of the same
    /// type: the virtual <see cref="object.Equals(object)"/> in both
    /// directions, the generic <see cref="EqualityComparer{T}"/> comparer
    /// (which a record backs with its <c>IEquatable&lt;T&gt;</c>
    /// implementation), and — when equal — equal hash codes. Hash-code
    /// inequality is never asserted for non-equal instances (collisions are
    /// legal), but the hash must never differ for equal instances.
    /// </summary>
    public static void AssertEquality<T>(T a, T b, bool expectedEqual)
    {
        Assert.NotNull(a);
        Assert.NotNull(b);
        Assert.Equal(expectedEqual, a!.Equals(b));
        Assert.Equal(expectedEqual, b!.Equals(a));
        Assert.Equal(expectedEqual, EqualityComparer<T>.Default.Equals(a, b));
        if (expectedEqual)
        {
            Assert.Equal(a.GetHashCode(), b.GetHashCode());
        }
    }

    /// <summary>
    /// True when <paramref name="type"/> has the compiler-synthesized record
    /// copy method (<c>&lt;Clone&gt;$</c>), which only records and record
    /// structs emit. Searched across public and non-public instance members.
    /// </summary>
    private static bool IsRecord(Type type) =>
        type.GetMethod(
            "<Clone>$",
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
        is not null;
}
