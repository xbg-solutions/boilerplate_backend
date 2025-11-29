/**
 * ERP Connector - Unit Tests
 *
 * Testing WHAT the ERP connector does, not HOW it works internally:
 * - Manages employee data and profiles
 * - Handles time off requests and balances
 * - Provides payroll information
 * - Manages expense reports
 * - Organizes departments and job requisitions
 * - Provides provider abstraction for ERP platforms (BambooHR, Gusto, Workday, etc.)
 */

import { ERPConnector, ERPProvider } from '../erp-connector';
import {
  Employee,
  TimeOffRequest,
  TimeOffBalance,
  PayStub,
  ExpenseReport,
  Department,
  JobRequisition,
  ERPQueryOptions,
  ERPResponse,
} from '../types';
import { logger } from '../../logger';

// Mock logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ERP Connector', () => {
  let mockProvider: jest.Mocked<ERPProvider>;
  let connector: ERPConnector;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      getEmployee: jest.fn(),
      getEmployees: jest.fn(),
      createEmployee: jest.fn(),
      updateEmployee: jest.fn(),
      requestTimeOff: jest.fn(),
      getTimeOffBalance: jest.fn(),
      getTimeOffRequests: jest.fn(),
      getPayStubs: jest.fn(),
      createExpenseReport: jest.fn(),
      getExpenseReports: jest.fn(),
      getDepartment: jest.fn(),
      getDepartments: jest.fn(),
      getJobRequisitions: jest.fn(),
    };

    connector = new ERPConnector(mockProvider);
  });

  describe('getEmployee', () => {
    it('retrieves employee by ID', async () => {
      const employee: Employee = {
        id: 'emp-123',
        employeeId: 'E001',
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe',
        displayName: 'John Doe',
        jobTitle: 'Senior Engineer',
        department: 'Engineering',
        manager: {
          id: 'emp-mgr',
          name: 'Jane Smith',
        },
        hireDate: new Date('2020-01-15'),
        status: 'active',
        workLocation: 'San Francisco',
        workPhone: '+1-555-0100',
      };

      mockProvider.getEmployee.mockResolvedValue(employee);

      const result = await connector.getEmployee('emp-123');

      expect(mockProvider.getEmployee).toHaveBeenCalledWith('emp-123');
      expect(result.id).toBe('emp-123');
      expect(result.email).toBe('john.doe@example.com');
      expect(result.jobTitle).toBe('Senior Engineer');
    });

    it('logs employee fetch', async () => {
      const employee: Employee = {
        id: 'emp-456',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        status: 'active',
      };

      mockProvider.getEmployee.mockResolvedValue(employee);

      await connector.getEmployee('emp-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching employee',
        expect.objectContaining({
          employeeId: 'emp-456',
        })
      );
    });

    it('handles employee not found', async () => {
      mockProvider.getEmployee.mockRejectedValue(new Error('Employee not found'));

      await expect(connector.getEmployee('nonexistent')).rejects.toThrow('Employee not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getEmployees', () => {
    it('retrieves multiple employees', async () => {
      const response: ERPResponse<Employee> = {
        success: true,
        data: [
          {
            id: 'emp-1',
            email: 'user1@example.com',
            firstName: 'User',
            lastName: 'One',
            status: 'active',
          },
          {
            id: 'emp-2',
            email: 'user2@example.com',
            firstName: 'User',
            lastName: 'Two',
            status: 'active',
          },
        ],
        total: 2,
        page: 1,
        limit: 10,
      };

      mockProvider.getEmployees.mockResolvedValue(response);

      const result = await connector.getEmployees();

      expect(mockProvider.getEmployees).toHaveBeenCalledWith(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('filters employees with options', async () => {
      const options: ERPQueryOptions = {
        filters: { status: 'active', department: 'Engineering' },
        limit: 50,
        page: 1,
      };

      const response: ERPResponse<Employee> = {
        success: true,
        data: [],
        total: 0,
      };

      mockProvider.getEmployees.mockResolvedValue(response);

      await connector.getEmployees(options);

      expect(mockProvider.getEmployees).toHaveBeenCalledWith(options);
    });

    it('handles fetch errors', async () => {
      mockProvider.getEmployees.mockRejectedValue(new Error('API error'));

      await expect(connector.getEmployees()).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('createEmployee', () => {
    it('creates employee successfully', async () => {
      const newEmployee: Omit<Employee, 'id'> = {
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'Employee',
        jobTitle: 'Software Engineer',
        department: 'Engineering',
        hireDate: new Date('2025-11-01'),
        status: 'active',
        workLocation: 'Remote',
      };

      const createdEmployee: Employee = {
        id: 'emp-new',
        ...newEmployee,
      };

      mockProvider.createEmployee.mockResolvedValue(createdEmployee);

      const result = await connector.createEmployee(newEmployee);

      expect(mockProvider.createEmployee).toHaveBeenCalledWith(newEmployee);
      expect(result.id).toBe('emp-new');
      expect(result.email).toBe('newuser@example.com');
    });

    it('logs employee creation', async () => {
      const newEmployee: Omit<Employee, 'id'> = {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        status: 'active',
      };

      const createdEmployee: Employee = {
        id: 'emp-test',
        ...newEmployee,
      };

      mockProvider.createEmployee.mockResolvedValue(createdEmployee);

      await connector.createEmployee(newEmployee);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating employee',
        expect.objectContaining({
          email: 'test@example.com',
          name: 'Test User',
        })
      );
    });

    it('handles creation errors', async () => {
      const newEmployee: Omit<Employee, 'id'> = {
        email: 'invalid',
        firstName: 'Test',
        lastName: 'User',
        status: 'active',
      };

      mockProvider.createEmployee.mockRejectedValue(new Error('Invalid email'));

      await expect(connector.createEmployee(newEmployee)).rejects.toThrow('Invalid email');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateEmployee', () => {
    it('updates employee successfully', async () => {
      const updates: Partial<Employee> = {
        jobTitle: 'Lead Engineer',
        department: 'R&D',
      };

      const updatedEmployee: Employee = {
        id: 'emp-123',
        email: 'user@example.com',
        firstName: 'User',
        lastName: 'Name',
        jobTitle: 'Lead Engineer',
        department: 'R&D',
        status: 'active',
      };

      mockProvider.updateEmployee.mockResolvedValue(updatedEmployee);

      const result = await connector.updateEmployee('emp-123', updates);

      expect(mockProvider.updateEmployee).toHaveBeenCalledWith('emp-123', updates);
      expect(result.jobTitle).toBe('Lead Engineer');
      expect(result.department).toBe('R&D');
    });

    it('logs employee update', async () => {
      const updates: Partial<Employee> = {
        status: 'inactive',
      };

      const updatedEmployee: Employee = {
        id: 'emp-456',
        email: 'user@example.com',
        firstName: 'User',
        lastName: 'Name',
        status: 'inactive',
      };

      mockProvider.updateEmployee.mockResolvedValue(updatedEmployee);

      await connector.updateEmployee('emp-456', updates);

      expect(logger.info).toHaveBeenCalledWith(
        'Updating employee',
        expect.objectContaining({
          employeeId: 'emp-456',
          updates,
        })
      );
    });

    it('handles update errors', async () => {
      mockProvider.updateEmployee.mockRejectedValue(new Error('Employee not found'));

      await expect(
        connector.updateEmployee('nonexistent', { status: 'active' })
      ).rejects.toThrow('Employee not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('requestTimeOff', () => {
    it('submits time off request successfully', async () => {
      const request: TimeOffRequest = {
        employeeId: 'emp-123',
        type: 'vacation',
        startDate: new Date('2025-12-20'),
        endDate: new Date('2025-12-27'),
        hours: 56,
        reason: 'Holiday vacation',
        status: 'pending',
      };

      const response: ERPResponse<TimeOffRequest> = {
        success: true,
        data: [request],
      };

      mockProvider.requestTimeOff.mockResolvedValue(response);

      const result = await connector.requestTimeOff(request);

      expect(mockProvider.requestTimeOff).toHaveBeenCalledWith(request);
      expect(result.success).toBe(true);
    });

    it('logs time off request', async () => {
      const request: TimeOffRequest = {
        employeeId: 'emp-456',
        type: 'sick',
        startDate: new Date('2025-11-15'),
        endDate: new Date('2025-11-15'),
        hours: 8,
      };

      const response: ERPResponse<TimeOffRequest> = {
        success: true,
        data: [request],
      };

      mockProvider.requestTimeOff.mockResolvedValue(response);

      await connector.requestTimeOff(request);

      expect(logger.info).toHaveBeenCalledWith(
        'Requesting time off',
        expect.objectContaining({
          employeeId: 'emp-456',
          type: 'sick',
          startDate: request.startDate,
          endDate: request.endDate,
        })
      );
    });

    it('handles request errors', async () => {
      const request: TimeOffRequest = {
        employeeId: 'emp-123',
        type: 'vacation',
        startDate: new Date('2025-12-01'),
        endDate: new Date('2025-11-01'), // End before start
      };

      mockProvider.requestTimeOff.mockRejectedValue(new Error('Invalid date range'));

      await expect(connector.requestTimeOff(request)).rejects.toThrow('Invalid date range');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getTimeOffBalance', () => {
    it('retrieves time off balances', async () => {
      const balances: TimeOffBalance[] = [
        {
          employeeId: 'emp-123',
          type: 'vacation',
          balance: 120,
          unit: 'hours',
          accrualRate: 10,
        },
        {
          employeeId: 'emp-123',
          type: 'sick',
          balance: 40,
          unit: 'hours',
          accrualRate: 3.33,
        },
      ];

      mockProvider.getTimeOffBalance.mockResolvedValue(balances);

      const result = await connector.getTimeOffBalance('emp-123');

      expect(mockProvider.getTimeOffBalance).toHaveBeenCalledWith('emp-123');
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('vacation');
      expect(result[0].balance).toBe(120);
    });

    it('logs balance fetch', async () => {
      mockProvider.getTimeOffBalance.mockResolvedValue([]);

      await connector.getTimeOffBalance('emp-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching time off balance',
        expect.objectContaining({
          employeeId: 'emp-456',
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getTimeOffBalance.mockRejectedValue(new Error('Employee not found'));

      await expect(connector.getTimeOffBalance('nonexistent')).rejects.toThrow('Employee not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getTimeOffRequests', () => {
    it('retrieves time off requests', async () => {
      const requests: TimeOffRequest[] = [
        {
          employeeId: 'emp-123',
          type: 'vacation',
          startDate: new Date('2025-12-20'),
          endDate: new Date('2025-12-27'),
          status: 'approved',
        },
      ];

      const response: ERPResponse<TimeOffRequest> = {
        success: true,
        data: requests,
        total: 1,
      };

      mockProvider.getTimeOffRequests.mockResolvedValue(response);

      const result = await connector.getTimeOffRequests('emp-123');

      expect(mockProvider.getTimeOffRequests).toHaveBeenCalledWith('emp-123', undefined);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('filters requests with options', async () => {
      const options: ERPQueryOptions = {
        filters: { status: 'approved' },
      };

      const response: ERPResponse<TimeOffRequest> = {
        success: true,
        data: [],
      };

      mockProvider.getTimeOffRequests.mockResolvedValue(response);

      await connector.getTimeOffRequests('emp-456', options);

      expect(mockProvider.getTimeOffRequests).toHaveBeenCalledWith('emp-456', options);
    });

    it('handles fetch errors', async () => {
      mockProvider.getTimeOffRequests.mockRejectedValue(new Error('API error'));

      await expect(connector.getTimeOffRequests('emp-123')).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getPayStubs', () => {
    it('retrieves pay stubs', async () => {
      const payStubs: PayStub[] = [
        {
          id: 'paystub-1',
          employeeId: 'emp-123',
          payPeriodStart: new Date('2025-10-01'),
          payPeriodEnd: new Date('2025-10-15'),
          payDate: new Date('2025-10-20'),
          grossPay: 5000,
          netPay: 3750,
          deductions: [
            { type: 'tax', amount: 1000, description: 'Federal tax' },
            { type: 'insurance', amount: 250, description: 'Health insurance' },
          ],
          currency: 'USD',
        },
      ];

      const response: ERPResponse<PayStub> = {
        success: true,
        data: payStubs,
        total: 1,
      };

      mockProvider.getPayStubs.mockResolvedValue(response);

      const result = await connector.getPayStubs('emp-123');

      expect(mockProvider.getPayStubs).toHaveBeenCalledWith('emp-123', undefined);
      expect(result.success).toBe(true);
      expect(result.data?.[0].grossPay).toBe(5000);
    });

    it('logs pay stub fetch', async () => {
      const response: ERPResponse<PayStub> = {
        success: true,
        data: [],
      };

      mockProvider.getPayStubs.mockResolvedValue(response);

      await connector.getPayStubs('emp-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching pay stubs',
        expect.objectContaining({
          employeeId: 'emp-456',
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getPayStubs.mockRejectedValue(new Error('Unauthorized'));

      await expect(connector.getPayStubs('emp-123')).rejects.toThrow('Unauthorized');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('createExpenseReport', () => {
    it('creates expense report successfully', async () => {
      const expense: ExpenseReport = {
        employeeId: 'emp-123',
        date: new Date('2025-10-15'),
        description: 'Client dinner',
        amount: 150.00,
        currency: 'USD',
        category: 'meals',
        status: 'draft',
        receipts: [
          {
            url: 'https://example.com/receipt.pdf',
            filename: 'receipt.pdf',
          },
        ],
      };

      const createdExpense: ExpenseReport = {
        id: 'expense-new',
        ...expense,
      };

      mockProvider.createExpenseReport.mockResolvedValue(createdExpense);

      const result = await connector.createExpenseReport(expense);

      expect(mockProvider.createExpenseReport).toHaveBeenCalledWith(expense);
      expect(result.id).toBe('expense-new');
      expect(result.amount).toBe(150.00);
    });

    it('logs expense creation', async () => {
      const expense: ExpenseReport = {
        employeeId: 'emp-456',
        date: new Date('2025-10-20'),
        description: 'Conference travel',
        amount: 500.00,
        currency: 'USD',
        category: 'travel',
      };

      const createdExpense: ExpenseReport = {
        id: 'expense-test',
        ...expense,
      };

      mockProvider.createExpenseReport.mockResolvedValue(createdExpense);

      await connector.createExpenseReport(expense);

      expect(logger.info).toHaveBeenCalledWith(
        'Creating expense report',
        expect.objectContaining({
          employeeId: 'emp-456',
          amount: 500.00,
          category: 'travel',
        })
      );
    });

    it('handles creation errors', async () => {
      const expense: ExpenseReport = {
        employeeId: 'emp-invalid',
        date: new Date(),
        description: 'Test',
        amount: -10,
        currency: 'USD',
        category: 'other',
      };

      mockProvider.createExpenseReport.mockRejectedValue(new Error('Invalid amount'));

      await expect(connector.createExpenseReport(expense)).rejects.toThrow('Invalid amount');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getExpenseReports', () => {
    it('retrieves expense reports', async () => {
      const expenses: ExpenseReport[] = [
        {
          id: 'expense-1',
          employeeId: 'emp-123',
          date: new Date('2025-10-15'),
          description: 'Client dinner',
          amount: 150.00,
          currency: 'USD',
          category: 'meals',
          status: 'approved',
        },
      ];

      const response: ERPResponse<ExpenseReport> = {
        success: true,
        data: expenses,
        total: 1,
      };

      mockProvider.getExpenseReports.mockResolvedValue(response);

      const result = await connector.getExpenseReports('emp-123');

      expect(mockProvider.getExpenseReports).toHaveBeenCalledWith('emp-123', undefined);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('filters expenses with options', async () => {
      const options: ERPQueryOptions = {
        filters: { status: 'approved' },
      };

      const response: ERPResponse<ExpenseReport> = {
        success: true,
        data: [],
      };

      mockProvider.getExpenseReports.mockResolvedValue(response);

      await connector.getExpenseReports('emp-456', options);

      expect(mockProvider.getExpenseReports).toHaveBeenCalledWith('emp-456', options);
    });

    it('handles fetch errors', async () => {
      mockProvider.getExpenseReports.mockRejectedValue(new Error('API error'));

      await expect(connector.getExpenseReports('emp-123')).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getDepartment', () => {
    it('retrieves department by ID', async () => {
      const department: Department = {
        id: 'dept-123',
        name: 'Engineering',
        code: 'ENG',
        manager: {
          id: 'emp-mgr',
          name: 'Engineering Manager',
        },
        employeeCount: 45,
      };

      mockProvider.getDepartment.mockResolvedValue(department);

      const result = await connector.getDepartment('dept-123');

      expect(mockProvider.getDepartment).toHaveBeenCalledWith('dept-123');
      expect(result.id).toBe('dept-123');
      expect(result.name).toBe('Engineering');
      expect(result.employeeCount).toBe(45);
    });

    it('logs department fetch', async () => {
      const department: Department = {
        id: 'dept-456',
        name: 'Sales',
      };

      mockProvider.getDepartment.mockResolvedValue(department);

      await connector.getDepartment('dept-456');

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching department',
        expect.objectContaining({
          departmentId: 'dept-456',
        })
      );
    });

    it('handles department not found', async () => {
      mockProvider.getDepartment.mockRejectedValue(new Error('Department not found'));

      await expect(connector.getDepartment('nonexistent')).rejects.toThrow('Department not found');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getDepartments', () => {
    it('retrieves all departments', async () => {
      const departments: Department[] = [
        {
          id: 'dept-1',
          name: 'Engineering',
          employeeCount: 45,
        },
        {
          id: 'dept-2',
          name: 'Sales',
          employeeCount: 30,
        },
      ];

      const response: ERPResponse<Department> = {
        success: true,
        data: departments,
        total: 2,
      };

      mockProvider.getDepartments.mockResolvedValue(response);

      const result = await connector.getDepartments();

      expect(mockProvider.getDepartments).toHaveBeenCalledWith(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('filters departments with options', async () => {
      const options: ERPQueryOptions = {
        sort: { field: 'name', order: 'asc' },
      };

      const response: ERPResponse<Department> = {
        success: true,
        data: [],
      };

      mockProvider.getDepartments.mockResolvedValue(response);

      await connector.getDepartments(options);

      expect(mockProvider.getDepartments).toHaveBeenCalledWith(options);
    });

    it('handles fetch errors', async () => {
      mockProvider.getDepartments.mockRejectedValue(new Error('API error'));

      await expect(connector.getDepartments()).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getJobRequisitions', () => {
    it('retrieves job requisitions', async () => {
      const requisitions: JobRequisition[] = [
        {
          id: 'job-1',
          title: 'Senior Software Engineer',
          department: 'Engineering',
          status: 'open',
          openDate: new Date('2025-10-01'),
          hiringManager: {
            id: 'emp-mgr',
            name: 'Hiring Manager',
          },
          description: 'We are looking for a senior engineer...',
          requirements: ['5+ years experience', 'Strong JavaScript skills'],
        },
      ];

      const response: ERPResponse<JobRequisition> = {
        success: true,
        data: requisitions,
        total: 1,
      };

      mockProvider.getJobRequisitions.mockResolvedValue(response);

      const result = await connector.getJobRequisitions();

      expect(mockProvider.getJobRequisitions).toHaveBeenCalledWith(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].title).toBe('Senior Software Engineer');
    });

    it('filters requisitions with options', async () => {
      const options: ERPQueryOptions = {
        filters: { status: 'open' },
      };

      const response: ERPResponse<JobRequisition> = {
        success: true,
        data: [],
      };

      mockProvider.getJobRequisitions.mockResolvedValue(response);

      await connector.getJobRequisitions(options);

      expect(mockProvider.getJobRequisitions).toHaveBeenCalledWith(options);
    });

    it('logs requisitions fetch', async () => {
      const response: ERPResponse<JobRequisition> = {
        success: true,
        data: [],
      };

      mockProvider.getJobRequisitions.mockResolvedValue(response);

      await connector.getJobRequisitions();

      expect(logger.info).toHaveBeenCalledWith(
        'Fetching job requisitions',
        expect.objectContaining({
          options: undefined,
        })
      );
    });

    it('handles fetch errors', async () => {
      mockProvider.getJobRequisitions.mockRejectedValue(new Error('API error'));

      await expect(connector.getJobRequisitions()).rejects.toThrow('API error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles non-Error exceptions', async () => {
      mockProvider.getEmployee.mockRejectedValue('String error');

      await expect(connector.getEmployee('emp-123')).rejects.toBe('String error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs all errors appropriately', async () => {
      mockProvider.createEmployee.mockRejectedValue(new Error('Test error'));

      await expect(
        connector.createEmployee({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          status: 'active',
        })
      ).rejects.toThrow('Test error');

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating employee',
        expect.any(Error)
      );
    });
  });
});
