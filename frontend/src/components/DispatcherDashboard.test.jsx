import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/react";
import DispatcherDashboard from "./DispatcherDashboard";
import { deliveriesAPI, dronesAPI, simulatorAPI } from "../services/api";

const mockToast = {
  error: jest.fn(),
  success: jest.fn(),
};

jest.mock("../hooks/useToast", () => ({
  useToast: () => mockToast,
}));

jest.mock("../hooks/useDeliveryUpdates", () => ({
  useDeliveryUpdates: () => ({ connected: false }),
}));

jest.mock("../hooks/useWebSocketMonitor", () => ({
  useWebSocketMonitor: () => ({ isConnected: false }),
}));

jest.mock("./ScenarioPanel", () => function ScenarioPanel() {
  return <div>Scenario panel</div>;
});

jest.mock("../services/api", () => ({
  deliveriesAPI: {
    getDashboardDispatcher: jest.fn(),
    getDroneScores: jest.fn(),
    assign: jest.fn(),
    batchAssign: jest.fn(),
  },
  dronesAPI: {
    fleetStatus: jest.fn(),
  },
  simulatorAPI: {
    pause: jest.fn(),
    resume: jest.fn(),
    abortMission: jest.fn(),
    resetFleet: jest.fn(),
  },
  getErrorMessage: jest.fn((err, fallback) => err?.response?.data?.detail || fallback),
}));

describe("DispatcherDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deliveriesAPI.getDashboardDispatcher.mockResolvedValue({
      data: {
        deliveries: {
          total: 9,
          pending: 1,
          assigned: 1,
          picking_up: 1,
          in_transit: 2,
          delivered: 1,
          confirmed: 1,
          cancelled: 1,
          failed: 1,
        },
        urgent_actions: {
          pending_unassigned: [
            {
              id: 18,
              customer_id: 2,
              customer_name: "Maria Popescu",
              distance_km: 12.4,
              priority: "normal",
              package_type: "standard",
              weight_kg: 1.5,
            },
          ],
        },
      },
    });
    dronesAPI.fleetStatus.mockResolvedValue({
      data: {
        summary: {
          total: 1,
          by_status: { idle: 1, in_mission: 0, charging: 0 },
          avg_battery: 100,
          avg_health: 100,
        },
        drones: [],
      },
    });
  });

  it("shows customer names in the pending tab when available", async () => {
    render(<DispatcherDashboard />);

    await waitFor(() => expect(deliveriesAPI.getDashboardDispatcher).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: /pending \(1\)/i }));

    expect(await screen.findByText("Customer:", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Maria Popescu")).toBeInTheDocument();
    expect(screen.queryByText("#2")).not.toBeInTheDocument();
  });

  it("shows a delivery breakdown that reconciles with the total count", async () => {
    render(<DispatcherDashboard />);

    await waitFor(() => expect(deliveriesAPI.getDashboardDispatcher).toHaveBeenCalled());
    await screen.findByText("Total");

    expect(getStatValue("Total")).toBe("9");
    expect(getStatValue("Pending")).toBe("1");
    expect(getStatValue("Assigned")).toBe("1");
    expect(getStatValue("In Transit")).toBe("3");
    expect(getStatValue("Delivered")).toBe("1");
    expect(getStatValue("Confirmed")).toBe("1");
    expect(getStatValue("Failed")).toBe("1");
    expect(getStatValue("Cancelled")).toBe("1");
    expect(screen.getByText(/Total matches: Pending \+ Assigned \+ In Transit \+ Delivered \+ Confirmed \+ Failed \+ Cancelled\./i)).toBeInTheDocument();
  });

  it("shows IN MISSION when a drone has an active mission even if the raw status says idle", async () => {
    dronesAPI.fleetStatus.mockResolvedValue({
      data: {
        summary: {
          total: 1,
          by_status: { idle: 0, in_mission: 1, charging: 0 },
          avg_battery: 82,
          avg_health: 97,
        },
        drones: [
          {
            id: 7,
            name: "Drone Fleet Badge",
            status: "idle",
            battery: 82,
            battery_health: 97,
            estimated_range_km: 24,
            total_flight_km: 12,
            total_charge_cycles: 3,
            motor_efficiency: 0.92,
            mission: {
              id: 101,
              progress_pct: 42,
              remaining_km: 3.6,
              status: "planned",
            },
            delivery: {
              id: 55,
              package_type: "medical",
              status: "assigned",
            },
          },
        ],
      },
    });

    render(<DispatcherDashboard />);

    await waitFor(() => expect(dronesAPI.fleetStatus).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: /fleet \(1\)/i }));

    expect(await screen.findByText("Drone Fleet Badge")).toBeInTheDocument();
    expect(screen.getByText("IN MISSION")).toBeInTheDocument();
    expect(screen.queryByText("AVAILABLE")).not.toBeInTheDocument();
    expect(screen.getByText(/Progress: 42%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /abort/i })).toBeInTheDocument();
  });
});

function getStatValue(label) {
  const statLabel = screen.getByText(label);
  const statCard = statLabel.closest(".stat-card");
  expect(statCard).not.toBeNull();
  return within(statCard).getByText(/^[0-9]+$/).textContent;
}