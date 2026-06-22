import { render, screen, within } from "@testing-library/react";
import DeliveryTracker from "./DeliveryTracker";
import { useDeliveryTracking } from "../hooks/useDeliveryTracking";
import { chargingAPI } from "../services/api";

jest.mock("leaflet", () => ({
  __esModule: true,
  default: {
    DivIcon: class DivIcon {
      constructor(options) {
        this.options = options;
      }
    },
  },
}));

jest.mock("react-leaflet", () => ({
  MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Polyline: () => <div data-testid="polyline" />,
  Circle: () => <div data-testid="circle" />,
  useMap: () => ({ fitBounds: jest.fn() }),
}));

jest.mock("../hooks/useDeliveryTracking", () => ({
  useDeliveryTracking: jest.fn(),
}));

jest.mock("../services/api", () => ({
  chargingAPI: {
    getStations: jest.fn(() => Promise.resolve({ data: { stations: [] } })),
  },
}));

jest.mock("./ProofOfDelivery", () => function ProofOfDelivery() {
  return null;
});

describe("DeliveryTracker", () => {
  beforeEach(() => {
    chargingAPI.getStations.mockReset();
    chargingAPI.getStations.mockResolvedValue({ data: { stations: [] } });
    useDeliveryTracking.mockReturnValue({
      loading: false,
      error: null,
      tracking: {
        delivery_id: 42,
        status: "in_transit",
        priority: "normal",
        package_type: "medical",
        pickup_lat: 44.4268,
        pickup_lon: 26.1025,
        dest_lat: 44.4378,
        dest_lon: 26.0496,
        estimated_distance_km: 8.4,
        estimated_duration_h: 0.25,
        drone: {
          id: 5,
          name: "Falcon-5",
          latitude: 44.4312,
          longitude: 26.0801,
          battery: 78,
          status: "in_mission",
          route_path: [
            [44.4268, 26.1025],
            [44.429, 26.094],
            [44.4312, 26.0801],
            [44.4378, 26.0496],
          ],
          route_index: 2,
          charge_count: 0,
          battery_health: 97,
        },
        mission: {
          progress_pct: 61.2,
          remaining_km: 3.3,
          remaining_duration_h: 0.11,
          total_distance_km: 8.4,
          status: "en_route_delivery",
        },
        weather: null,
      },
    });
  });

  it("shows a clear active delivery summary on the map", async () => {
    render(<DeliveryTracker deliveryId={42} />);

    const summaryTitle = await screen.findByText("Map essentials");
    const summaryCard = summaryTitle.closest(".tracker__summary-card");

    expect(summaryCard).not.toBeNull();
    expect(within(summaryCard).getByText("Pickup Point")).toBeInTheDocument();
    expect(within(summaryCard).getByText("Destination")).toBeInTheDocument();
    expect(within(summaryCard).getByText("Current Drone Position")).toBeInTheDocument();
    expect(within(summaryCard).getByText("Route")).toBeInTheDocument();
    expect(within(summaryCard).getByText("Status")).toBeInTheDocument();
    expect(within(summaryCard).getByText("ETA")).toBeInTheDocument();
    expect(within(summaryCard).getByText("44.4268, 26.1025")).toBeInTheDocument();
    expect(within(summaryCard).getByText("44.4378, 26.0496")).toBeInTheDocument();
    expect(within(summaryCard).getByText("44.4312, 26.0801")).toBeInTheDocument();
    expect(within(summaryCard).getByText("3.3 km remaining")).toBeInTheDocument();
    expect(within(summaryCard).getAllByText("in transit").length).toBeGreaterThan(0);
    expect(within(summaryCard).getByText("7 min")).toBeInTheDocument();
  });
});