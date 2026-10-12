const retired = () =>
  Response.json(
    {
      error: "step_libraries_retired",
      message: "Steps now belong to global or organization templates.",
    },
    { status: 410 },
  );
export { retired as GET, retired as POST, retired as PATCH, retired as DELETE };
