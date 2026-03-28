/**
 * User Controller
 * Generated from data model specification
 */

import { BaseController } from '@xbg.solutions/backend-core';
import { User } from '../entities/User';
import { UserService } from '../services/UserService';

export class UserController extends BaseController<User> {
  constructor(service: UserService, basePath = '/users') {
    super(service, basePath);
  }

  /**
   * Register custom routes
   */
  protected registerRoutes(): void {
    // Register standard CRUD routes
    super.registerRoutes();

    // Add custom routes here
    // this.router.get('/by-email/:email', this.handleFindByEmail.bind(this));
  }

  /**
   * Find User by email
   */
  // protected async handleFindByEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  //   try {
  //     const context = this.createContext(req);
  //     const { email } = req.params;
  //
  //     // Implementation here
  //   } catch (error) {
  //     next(error);
  //   }
  // }
}
