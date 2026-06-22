import { render, screen, waitFor } from "@testing-library/react";
import DeliveryDiagnostics from "./DeliveryDiagnostics";
import { deliveriesAPI } from "../services/api";

const mockToast = {
  error: jest.fn(),
};

jest.mock("../hooks/useToast", () => ({
  useToast: () => mockToast,
}));

jest.mock("../services/api", () => ({
  deliveriesAPI: {
    diagnostics: jest.fn(),
    getById: jest.fn(),
    timeline: jest.fn(),
  },
  getErrorMessage: jest.fn((err, fallback) => err?.response?.data?.detail || fallback),
}));

describe("DeliveryDiagnostics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deliveriesAPI.diagnostics.mockResolvedValue({
      data: {
        status: "pending",
        is_assigned: false,
        result: "Auto-assignment failed",
        primary_reason: "No available drone has sufficient battery for this route.",
        delivery_requirements: {
          pickup: "46.7701, 23.5901",
          destination: "46.8002, 23.6502",
          distance_km: 154.7,
          priority: "normal",
          package_type: "standard",
          weight_kg: 1,
          estimated_duration_h: 2.5,
        },
        fleet_analysis: [
          {
            drone_id: 1,
            drone_name: "Drone Alpha",
            status: "in_mission",
            status_label: "In Mission",
            battery: 82,
            estimated_range_km: 60.2,
            verdict: "Busy",
            reason: "already busy",
            reason_label: "Already in mission",
          },
          {
            drone_id: 2,
            drone_name: "Drone Beta",
            status: "idle",
            status_label: "Available",
            battery: 5,
            estimated_range_km: 8.1,
            verdict: "Rejected",
            reason: "battery too low",
            reason_label: "Battery too low",
          },
        ],
        rejected_drones: [
          { drone_id: 1, drone_name: "Drone Alpha", reason: "already busy", reason_label: "Already in mission" },
          { drone_id: 2, drone_name: "Drone Beta", reason: "battery too low", reason_label: "Battery too low" },
        ],
        recommendations: ["Retry assignment after charging a drone with enough range."],
      },
    });
    deliveriesAPI.getById.mockResolvedValue({ data: null });
    deliveriesAPI.timeline.mockResolvedValue({ data: null });
  });

  it("renders as an overlay modal shell", async () => {
    render(<DeliveryDiagnostics deliveryId={21} onClose={jest.fn()} />);

    expect(screen.getByLabelText("Assignment Diagnostics modal")).toHaveClass("app-modal");
    expect(screen.getByRole("heading", { name: /assignment diagnostics/i })).toBeInTheDocument();
    expect(screen.getByText(/order #21/i)).toBeInTheDocument();
    expect(await screen.findByText("Assignment Summary")).toBeInTheDocument();
    expect(screen.getByText("Auto-assignment failed")).toBeInTheDocument();
    expect(screen.getByText("No available drone has sufficient battery for this route.")).toBeInTheDocument();
    expect(screen.getByText("Delivery Requirements")).toBeInTheDocument();
    expect(screen.getByText("154.7 km")).toBeInTheDocument();
    expect(screen.getByText("1.0 kg")).toBeInTheDocument();
    expect(screen.getByText("Fleet Analysis")).toBeInTheDocument();
    expect(screen.getByText("Drone Alpha")).toBeInTheDocument();
    expect(screen.getByText("Already in mission")).toBeInTheDocument();
    expect(screen.getByText("Recommendation")).toBeInTheDocument();
    expect(screen.getByText("Retry assignment after charging a drone with enough range.")).toBeInTheDocument();
    await waitFor(() => expect(deliveriesAPI.diagnostics).toHaveBeenCalledWith(21));
  });

  it("shows the explicit empty-state copy when no rejected drones are available", async () => {
    deliveriesAPI.diagnostics.mockResolvedValueOnce({
      data: {
        status: "pending",
        is_assigned: false,
        primary_reason: "No idle drones are available right now.",
        result: "Auto-assignment failed",
        delivery_requirements: null,
        fleet_analysis: [],
        rejected_drones: [],
        recommendations: [],
      },
    });

    render(<DeliveryDiagnostics deliveryId={22} onClose={jest.fn()} />);

    expect(await screen.findByText("No drone evaluation details are available for this order yet.")).toBeInTheDocument();
  });

  it("renders failure diagnostics using the delivery details and timeline", async () => {
    deliveriesAPI.diagnostics.mockResolvedValueOnce({
      data: {
        id: 41,
        status: "failed",
        failure_reason: "Battery too low during route",
        failed_step: "In transit",
        affected_drone: {
          id: 7,
          name: "Drone #7",
          status: "in_mission",
        },
        what_happened: "The assigned drone encountered unsafe weather and the mission was aborted.",
        mission_context: [
          {
            event_type: "CHARGE",
            label: "Stop at charging station",
            timestamp: "2026-04-24T09:40:00Z",
            details: "Charging started at station 3.",
            is_failure_event: false,
          },
          {
            event_type: "RESUME",
            label: "Flight resumed",
            timestamp: "2026-04-24T09:55:00Z",
            details: "Mission resumed after charging.",
            is_failure_event: false,
          },
          {
            event_type: "MISSION_ABORTED",
            label: "Mission failed",
            timestamp: "2026-04-24T10:15:00Z",
            details: "Mission aborted due to weather near waypoint 4.",
            is_failure_event: true,
          },
        ],
        operational_impact: ["Delivery not completed", "Customer not served", "Reassignment unavailable"],
        recommendations: ["Reassign to a different drone"],
      },
    });

    render(<DeliveryDiagnostics deliveryId={41} onClose={jest.fn()} mode="failure" />);

    expect(screen.getByLabelText("Failure Diagnostics modal")).toHaveClass("app-modal");
    expect(screen.getByRole("heading", { name: /failure diagnostics/i })).toBeInTheDocument();
    expect(await screen.findByText("Battery too low during route")).toBeInTheDocument();
    expect(screen.getByText("Failure Summary")).toBeInTheDocument();
    expect(screen.getByText("Failure Reason")).toBeInTheDocument();
    expect(screen.getByText("Affected Drone")).toBeInTheDocument();
    expect(screen.getByText("Drone #7")).toBeInTheDocument();
    expect(screen.getByText("What Happened")).toBeInTheDocument();
    expect(screen.getByText("The assigned drone encountered unsafe weather and the mission was aborted.")).toBeInTheDocument();
    expect(screen.getByText("Failed Step")).toBeInTheDocument();
    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(screen.getByText("Mission Context")).toBeInTheDocument();
    expect(screen.getByText("Stop at charging station")).toBeInTheDocument();
    expect(screen.getByText("Mission failed")).toBeInTheDocument();
    expect(screen.getByText("Failure event")).toBeInTheDocument();
    expect(screen.getByText("Operational Impact")).toBeInTheDocument();
    expect(screen.getByText("Delivery not completed")).toBeInTheDocument();
    expect(screen.getByText("Recommendation")).toBeInTheDocument();
    expect(screen.getByText("Reassign to a different drone")).toBeInTheDocument();
    await waitFor(() => expect(deliveriesAPI.diagnostics).toHaveBeenCalledWith(41));
  });
});