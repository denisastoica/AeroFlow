import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeliveryHistory from "./DeliveryHistory";
import { deliveriesAPI } from "../services/api";

const mockToast = {
  error: jest.fn(),
};

jest.mock("../hooks/useToast", () => ({
  useToast: () => mockToast,
}));

jest.mock("../services/api", () => ({
  deliveriesAPI: {
    search: jest.fn(),
  },
  getErrorMessage: jest.fn((err, fallback) => err?.response?.data?.detail || fallback),
}));

jest.mock("./ProofOfDelivery", () => function ProofOfDelivery() {
  return <div>Proof of Delivery</div>;
});

jest.mock("./DeliveryDiagnostics", () => function DeliveryDiagnostics() {
  return <div>Delivery Diagnostics</div>;
});

jest.mock("./DeliveryDetailsModal", () => function DeliveryDetailsModal() {
  return <div>Delivery Details</div>;
});

jest.mock("./DeliveryTracker", () => function DeliveryTracker() {
  return <div>Delivery Tracker</div>;
});

describe("DeliveryHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deliveriesAPI.search.mockResolvedValue({
      data: {
        items: [
          {
            id: 21,
            customer_id: 2,
            customer_name: "Maria Popescu",
            created_at: "2026-04-24T09:00:00Z",
            package_type: "standard",
            weight_kg: 1.5,
            status: "pending",
            drone_id: null,
          },
        ],
        total: 1,
        page: 1,
        page_size: 15,
        total_pages: 1,
        filters_applied: {},
        sort_by: "created_at",
        sort_order: "desc",
      },
    });
  });

  it("shows customer name instead of fallback user id in all deliveries", async () => {
    render(<DeliveryHistory />);

    await waitFor(() => expect(deliveriesAPI.search).toHaveBeenCalled());
    expect(await screen.findByText("Maria Popescu")).toBeInTheDocument();
    expect(screen.queryByText("User #2")).not.toBeInTheDocument();
  });

  it("renders status-specific actions in all deliveries", async () => {
    deliveriesAPI.search.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 31,
            customer_id: 2,
            customer_name: "Pending User",
            created_at: "2026-04-24T09:00:00Z",
            package_type: "standard",
            weight_kg: 1,
            status: "pending",
            drone_id: null,
          },
          {
            id: 32,
            customer_id: 3,
            customer_name: "Transit User",
            created_at: "2026-04-24T09:05:00Z",
            package_type: "standard",
            weight_kg: 1,
            status: "assigned",
            drone_id: 7,
          },
          {
            id: 33,
            customer_id: 4,
            customer_name: "Delivered User",
            created_at: "2026-04-24T09:10:00Z",
            package_type: "standard",
            weight_kg: 1,
            status: "delivered",
            drone_id: 9,
          },
          {
            id: 34,
            customer_id: 5,
            customer_name: "Failed User",
            created_at: "2026-04-24T09:15:00Z",
            package_type: "standard",
            weight_kg: 1,
            status: "failed",
            drone_id: null,
          },
          {
            id: 35,
            customer_id: 6,
            customer_name: "Confirmed User",
            created_at: "2026-04-24T09:20:00Z",
            package_type: "standard",
            weight_kg: 1,
            status: "confirmed",
            drone_id: 10,
          },
        ],
        total: 5,
        page: 1,
        page_size: 15,
        total_pages: 1,
        filters_applied: {},
        sort_by: "created_at",
        sort_order: "desc",
      },
    });

    render(<DeliveryHistory />);

    await waitFor(() => expect(deliveriesAPI.search).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Assignment Diagnostics" })).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Track / Mission" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Proof of Delivery" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Failure Diagnostics" })).toBeInTheDocument();
    expect(screen.getByText("Confirmed User")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Track / Mission" }));
    expect(screen.getByLabelText("Delivery tracker modal")).toBeInTheDocument();
    expect(screen.getByText("Delivery Tracker")).toBeInTheDocument();
  });
});