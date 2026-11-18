import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Dashboard from "./Dashboard";

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/speaking"  element={<p>Speaking page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  it("shows a Speaking card that opens the speaking exercise", () => {
    renderDashboard();

    fireEvent.click(screen.getByRole("heading", { name: /speaking/i }));

    expect(screen.getByText("Speaking page")).toBeInTheDocument();
  });
});
