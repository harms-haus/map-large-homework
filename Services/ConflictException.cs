namespace TestProject.Services;

/// <summary>Thrown on copy/move/create-directory collisions; maps to
/// <c>409 Conflict</c>. Not an <see cref="IOException"/> subclass.</summary>
public class ConflictException : Exception
{
    public ConflictException(string message) : base(message) { }
}
