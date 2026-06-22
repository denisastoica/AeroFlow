import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerDashboard from "./CustomerDashboard";
import { deliveriesAPI, geocodingAPI, proofOfDeliveryAPI } from "../services/api";
import { DEMO_PROOF_PHOTO_URL } from "../utils/proofPhoto";

const mockToast = {
  addToast: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
};

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 7, name: "Customer Test", role: "customer" },
  }),
}));

jest.mock("../hooks/useToast", () => ({
  useToast: () => mockToast,
}));

jest.mock("../hooks/useDeliveryUpdates", () => ({
  useDeliveryUpdates: () => ({ connected: false }),
}));

jest.mock("../services/api", () => ({
  deliveriesAPI: {
    getDashboardCustomer: jest.fn(),
    getById: jest.fn(),
  },
  geocodingAPI: {
    reverse: jest.fn(),
  },
  proofOfDeliveryAPI: {
    uploadPhoto: jest.fn(),
    confirm: jest.fn(),
    getProof: jest.fn(),
  },
  getErrorMessage: jest.fn((err, fallback) => err?.response?.data?.detail || fallback),
}));

jest.mock("./DeliveryForm", () => function DeliveryForm() {
  return <div>Create form</div>;
});

jest.mock("./DeliveryTracker", () => function DeliveryTracker() {
  return <div>Tracker</div>;
});

const initialDashboard = {
  total: 1,
  pending: 0,
  picking_up: 0,
  in_transit: 0,
  delivered: 1,
  confirmed: 0,
  recent_deliveries: [
    {
      id: 42,
      status: "delivered",
      priority: "normal",
      package_type: "medical",
      drone_id: 3,
      created_at: "2026-04-24T09:00:00Z",
      confirmed_at: null,
      failure_reason: null,
      estimated_distance_km: 8.2,
      estimated_duration_h: 0.25,
    },
  ],
};

const confirmedDashboard = {
  ...initialDashboard,
  delivered: 0,
  confirmed: 1,
  recent_deliveries: [
    {
      ...initialDashboard.recent_deliveries[0],
      confirmed_at: "2026-04-24T09:15:00Z",
    },
  ],
};

function getStatValue(label) {
  const labelNode = screen.getByText((content, element) => {
    return content === label && element?.classList.contains("stat-label");
  });
  return labelNode.previousElementSibling.textContent;
}

describe("CustomerDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deliveriesAPI.getDashboardCustomer
      .mockResolvedValueOnce({ data: initialDashboard })
      .mockResolvedValueOnce({ data: confirmedDashboard });
    deliveriesAPI.getById.mockResolvedValue({
      data: {
        ...initialDashboard.recent_deliveries[0],
        pickup_lat: 44.4268,
        pickup_lon: 26.1025,
        confirmation_code: "123456",
        completed_at: "2026-04-24T09:10:00Z",
        dest_lat: 44.4378,
        dest_lon: 26.0496,
      },
    });
    geocodingAPI.reverse
      .mockResolvedValueOnce({ data: { success: true, address: "Union Square, Cluj-Napoca" } })
      .mockResolvedValueOnce({ data: { success: true, address: "25 Horea St., Cluj-Napoca" } });
    proofOfDeliveryAPI.uploadPhoto.mockResolvedValue({ data: { ok: true } });
    proofOfDeliveryAPI.confirm.mockResolvedValue({
      data: {
        delivery_id: 42,
        confirmed_at: "2026-04-24T09:15:00Z",
        recipient_name: "Customer Test",
      },
    });
    proofOfDeliveryAPI.getProof.mockResolvedValue({
      data: {
        delivery_id: 42,
        status: "delivered",
        pickup_lat: 44.4268,
        pickup_lon: 26.1025,
        dest_lat: 44.4378,
        dest_lon: 26.0496,
        package_type: "medical",
        weight_kg: 1.0,
        created_at: "2026-04-24T09:00:00Z",
        completed_at: "2026-04-24T09:10:00Z",
        confirmed_at: "2026-04-24T09:15:00Z",
        confirmation_code: "123456",
        recipient_name: "Customer Test",
        recipient_signature: null,
        delivery_photo_url: DEMO_PROOF_PHOTO_URL,
        delivery_notes: "Package arrived intact.",
        drone_id: 3,
        customer_id: 7,
      },
    });
  });

  it("updates Confirmed flow after customer confirmation and allows viewing proof", async () => {
    render(<CustomerDashboard />);

    expect(await screen.findByText("Recent Orders")).toBeInTheDocument();
    expect(getStatValue("Confirmed")).toBe("0");
    expect(getStatValue("Delivered")).toBe("1");
    expect(screen.getByText("Check your email for the 6-digit confirmation code sent when the delivery was assigned.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /details/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(await screen.findByRole("heading", { name: /order #42/i })).toBeInTheDocument();
    expect(screen.getByText("A 6-digit confirmation code was sent to your email when the delivery was assigned.")).toBeInTheDocument();
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(screen.queryByText("Proof of Delivery")).not.toBeInTheDocument();
    expect(proofOfDeliveryAPI.getProof).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByText("Delivery Details")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await userEvent.type(screen.getByPlaceholderText("0 0 0 0 0 0"), "123456");
    await userEvent.type(screen.getByPlaceholderText("Your full name"), "Customer Test");
    await userEvent.type(screen.getByPlaceholderText("e.g. Package arrived intact."), "Package arrived intact.");
    await userEvent.click(screen.getByText(/advanced demo options/i));
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm package/i }));

    await waitFor(() => expect(proofOfDeliveryAPI.confirm).toHaveBeenCalledWith(42, {
      confirmation_code: "123456",
      recipient_name: "Customer Test",
      delivery_photo_url: DEMO_PROOF_PHOTO_URL,
      delivery_notes: "Package arrived intact.",
    }));
    expect(proofOfDeliveryAPI.uploadPhoto).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith("Delivery confirmed successfully!");
    await waitFor(() => expect(screen.queryByText("Confirm Receipt")).not.toBeInTheDocument());

    await waitFor(() => expect(getStatValue("Confirmed")).toBe("1"));
    expect(getStatValue("Delivered")).toBe("0");
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();

    const confirmedCard = screen.getByText("Confirmed ✅").closest(".delivery-card-premium");
    expect(confirmedCard).not.toBeNull();
    expect(within(confirmedCard).getByRole("button", { name: /view proof/i })).toBeInTheDocument();

    await userEvent.click(within(confirmedCard).getByRole("button", { name: /view proof/i }));

    expect(await screen.findByText("Proof of Delivery")).toBeInTheDocument();
    expect(await screen.findByText("Confirmed By")).toBeInTheDocument();
    expect(screen.getByText("Customer Test")).toBeInTheDocument();
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(proofOfDeliveryAPI.getProof).toHaveBeenCalledWith(42);
  });

  it("shows the short backend failure reason for failed orders", async () => {
    deliveriesAPI.getDashboardCustomer.mockReset();
    deliveriesAPI.getDashboardCustomer.mockResolvedValue({
      data: {
        total: 1,
        pending: 0,
        picking_up: 0,
        in_transit: 0,
        delivered: 0,
        confirmed: 0,
        recent_deliveries: [
          {
            id: 55,
            status: "failed",
            priority: "normal",
            package_type: "standard",
            drone_id: null,
            created_at: "2026-04-24T09:00:00Z",
            confirmed_at: null,
            failure_reason: "Weather issue",
            estimated_distance_km: 12.4,
            estimated_duration_h: 0.3,
          },
        ],
      },
    });

    render(<CustomerDashboard />);

    expect(await screen.findByText("Delivery Failed")).toBeInTheDocument();
    expect(screen.getByText("Reason: Weather issue")).toBeInTheDocument();
  });
});